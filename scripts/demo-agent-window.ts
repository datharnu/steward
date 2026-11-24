/**
 * The agent's OWN scoped EVM window, and the chain enforcing each of its limits.
 *
 *   npm run demo:window                       print the plan (reads the chain; signs and sends nothing)
 *   npm run demo:window -- --broadcast        run it and write deployments/agent-window.json
 *   npm run demo:window -- --funder <name>    the ~/.haven account that funds the agent (default spike)
 *
 * The owner's windows (approve, pause, unpause) are already recorded. This one belongs to
 * steward-agent (0x9C3876…E6be): the agent opens it with its own hybrid secp256k1 + ML-DSA-87
 * signature, scoped to PayGate, one transaction, a 20,000 uqor value budget and 600 blocks. Then:
 *
 *   P1  a call to another contract (fUSD.decimals())        -> refused: target limit
 *   P2  a PayGate call carrying 50,000 uqor                 -> refused: value limit
 *   P3  PayGate.ownerNonce() (a view function, no value)    -> lands: the window's one transaction
 *   P4  the same call again                                 -> refused: transaction limit
 *   W2  a second window of 20 blocks, left to expire unused
 *   P5  the same call after W2's expiry height              -> refused: duration limit
 *
 * Every probe is checked first against the live window so its refusal can only be the limit it
 * names (scripts/lib/agent-window.ts, preconditionFailures). Probes are signed with fixed gas and
 * sent with a raw eth_sendRawTransaction, so a refusal is recorded exactly as the node words it.
 * A refusal at broadcast has no transaction hash; the record keeps the hash the signed transaction
 * would have had, the height, and the node's error code and message.
 *
 * The agent's linked authenticator on the owner's account (spending rule `steward-agent`) is not
 * involved: it governs the agent key acting FOR the owner through MsgExecuteEVM, not the agent
 * account's own transactions.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fetchEvmWindow, msg, openEvmWindowMsg, type UnifiedAccount } from "@qorechain/sdk";
import { readMlDsaKey, TESTNET } from "haven-pq-kit";
import { keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AGENT_COSMOS,
  AGENT_EVM,
  AGENT_NAME,
  OTHER_TARGET,
  UQOR_WEI,
  asExpected,
  buildPlan,
  classifySubmission,
  emptyRecord,
  formatPlan,
  formatUqor,
  preconditionFailures,
  snapshotWindow,
  submitRawTransaction,
  type AgentWindowRecord,
  type Plan,
  type ProbeGas,
  type Step,
  type WindowSpec,
} from "./lib/agent-window.js";
import { NATIVE_FEE_UQOR, broadcast, evmClient, loadAccount, registerMlDsa } from "./lib/chain.js";

const OUT = "deployments/agent-window.json";
const PROBE_GAS = 40_000n;

type Args = { broadcast: boolean; funder: string };

export function parseArgs(argv: string[]): Args {
  const args: Args = { broadcast: false, funder: "spike" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--broadcast") args.broadcast = true;
    else if (a === "--funder") args.funder = argv[++i] ?? "";
    else throw new Error(`unknown argument ${a}`);
  }
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(args.funder)) throw new Error("--funder needs an account name");
  if (args.funder === AGENT_NAME) throw new Error("the agent cannot fund itself");
  return args;
}

async function uqorBalance(address: string): Promise<bigint> {
  const body = (await fetch(`${TESTNET.rest}/cosmos/bank/v1beta1/balances/${address}`).then((r) => r.json())) as {
    balances?: { denom: string; amount: string }[];
  };
  return BigInt(body.balances?.find((coin) => coin.denom === "uqor")?.amount ?? "0");
}

async function latestHeight(): Promise<bigint> {
  const body = (await fetch(`${TESTNET.rest}/cosmos/base/tendermint/v1beta1/blocks/latest`).then((r) => r.json())) as {
    block?: { header?: { height?: string } };
  };
  const height = body.block?.header?.height;
  if (!height) throw new Error("could not read the latest height");
  return BigInt(height);
}

async function nativeTxHeight(hash: string): Promise<string | undefined> {
  for (let i = 0; i < 10; i++) {
    const response = await fetch(`${TESTNET.rest}/cosmos/tx/v1beta1/txs/${hash}`);
    if (response.ok) {
      const body = (await response.json()) as { tx_response?: { height?: string } };
      if (body.tx_response?.height) return body.tx_response.height;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return undefined;
}

function save(record: AgentWindowRecord): void {
  writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`);
}

async function readState(funder: UnifiedAccount, agent: UnifiedAccount) {
  const client = evmClient();
  const [agentBalance, funderBalance, key, window, gasPrice, height] = await Promise.all([
    uqorBalance(agent.cosmos),
    uqorBalance(funder.cosmos),
    readMlDsaKey(client, agent.evm as Address),
    fetchEvmWindow({ rest: TESTNET.rest, address: agent.cosmos }),
    client.getGasPrice(),
    latestHeight(),
  ]);
  return { agentBalance, funderBalance, key, window, gasPrice, height };
}

async function preflight(payGate: Address, agent: Address): Promise<string> {
  const client = evmClient();
  const plan = buildPlan({
    funder: "-",
    payGate,
    agentBalanceUqor: 0n,
    agentRegistered: true,
    agentPossessionProven: true,
    nativeFeeUqor: NATIVE_FEE_UQOR,
    gas: { gas: PROBE_GAS, maxFeePerGas: 1n },
  });
  const results: string[] = [];
  for (const step of plan.steps) {
    const probe = step.probe;
    if (!probe || probe.valueUqor > 0n) continue;
    const gas = await client.estimateGas({ account: agent, to: probe.to, data: probe.data });
    if (gas > PROBE_GAS) throw new Error(`${probe.id} needs ${gas} gas, more than the fixed ${PROBE_GAS}`);
    results.push(`${probe.id}=${gas}`);
  }
  return results.join(", ");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.broadcast && existsSync(OUT)) throw new Error(`${OUT} exists; move it away before recording again`);
  const deployment = JSON.parse(readFileSync("deployments/paygate.json", "utf8")) as { payGate: Address };
  const payGate = deployment.payGate;
  const agent = await loadAccount(AGENT_NAME);
  if (agent.evm.toLowerCase() !== AGENT_EVM.toLowerCase() || agent.cosmos !== AGENT_COSMOS) {
    throw new Error(`~/.haven/${AGENT_NAME}.env derives ${agent.evm}, not the linked agent ${AGENT_EVM}`);
  }
  const funder = await loadAccount(args.funder);
  const state = await readState(funder, agent);
  const gas: ProbeGas = { gas: PROBE_GAS, maxFeePerGas: state.gasPrice };
  const plan = buildPlan({
    funder: args.funder,
    payGate,
    agentBalanceUqor: state.agentBalance,
    agentRegistered: state.key.registered,
    agentPossessionProven: state.key.possessionProven,
    nativeFeeUqor: NATIVE_FEE_UQOR,
    gas,
  });
  const estimates = await preflight(payGate, agent.evm as Address);
  console.log(
    formatPlan(plan, {
      agent: `${AGENT_NAME} ${agent.cosmos} ${agent.evm}`,
      "agent balance": formatUqor(state.agentBalance),
      "agent ML-DSA-87 key": state.key.registered
        ? `registered, algorithm ${state.key.algorithmId}, possessionProven=${state.key.possessionProven}`
        : "not registered",
      "agent window": state.window.found ? JSON.stringify(snapshotWindow(state.window)) : "none",
      funder: `${args.funder} ${funder.cosmos}, ${formatUqor(state.funderBalance)}`,
      PayGate: payGate,
      "other target": OTHER_TARGET,
      "gas price": `${state.gasPrice} wei`,
      "height": state.height.toString(),
      "gas estimates (eth_estimateGas, no window applied)": estimates,
    }),
  );
  if (plan.fundUqor > 0n && state.funderBalance < plan.funderUqor) {
    throw new Error(`${args.funder} holds ${state.funderBalance} uqor, needs ${plan.funderUqor}`);
  }
  if (!args.broadcast) {
    console.log("\nDry run: nothing was signed or sent. Add --broadcast to run it.");
    return;
  }
  await run(plan, { args, payGate, agent, funder, gas });
}

async function run(
  plan: Plan,
  ctx: { args: Args; payGate: Address; agent: UnifiedAccount; funder: UnifiedAccount; gas: ProbeGas },
): Promise<void> {
  const { agent, funder, gas } = ctx;
  const client = evmClient();
  const signer = privateKeyToAccount(agent.privateKey as Hex);
  const record = emptyRecord({
    payGate: ctx.payGate,
    agentCosmos: agent.cosmos,
    agentEvm: agent.evm,
    gas,
    windows: [plan.windows.W1, plan.windows.W2],
  });
  save(record);

  const fail = (step: Step, why: string): never => {
    save(record);
    throw new Error(`stopped at ${step.id}: ${why}. Partial record in ${OUT}.`);
  };

  for (const step of plan.steps) {
    console.log(`\n== ${step.id}: ${step.description}`);
    if (step.kind === "fund") {
      const hash = await broadcast(funder, [
        msg.bank.send({
          fromAddress: funder.cosmos,
          toAddress: agent.cosmos,
          amount: [{ denom: "uqor", amount: plan.fundUqor.toString() }],
        }),
      ]);
      const height = (await nativeTxHeight(hash)) ?? "?";
      record.transactions.push({ hash, tier: "pqc", note: `fund ${AGENT_NAME} with ${plan.fundUqor} uqor from ${ctx.args.funder}` });
      record.steps.push({ id: step.id, expect: step.expect, asExpected: true, height, hash, note: step.description });
      console.log(`funded: ${hash} (height ${height})`);
    } else if (step.kind === "register") {
      const hash = await registerMlDsa(AGENT_NAME);
      const key = await readMlDsaKey(client, agent.evm as Address);
      const ok = key.registered && key.algorithmId === 1 && key.possessionProven;
      if (hash) {
        record.transactions.push({ hash, tier: "enrollment", note: `${AGENT_NAME} ML-DSA-87 registration with proof of possession` });
      }
      record.steps.push({
        id: step.id,
        expect: step.expect,
        asExpected: ok,
        height: hash ? ((await nativeTxHeight(hash)) ?? "?") : "-",
        ...(hash ? { hash } : {}),
        note: `pqcKeyStatus: registered=${key.registered} algorithm=${key.algorithmId} possessionProven=${key.possessionProven}`,
      });
      if (!ok) fail(step, "pqcKeyStatus does not show a possession-proven ML-DSA-87 key");
    } else if (step.kind === "open") {
      const w = step.window as WindowSpec;
      const hash = await broadcast(
        agent,
        [
          openEvmWindowMsg({
            sender: agent.cosmos,
            blocks: w.blocks,
            maxTxs: w.maxTxs,
            maxValue: w.maxValueUqor.toString(),
            allowedTargets: w.targets,
          }),
        ],
        "hybrid",
      );
      const onChain = await fetchEvmWindow({ rest: TESTNET.rest, address: agent.cosmos });
      const height = (await nativeTxHeight(hash)) ?? "?";
      const entry = record.windows.find((x) => x.label === w.label);
      if (entry) Object.assign(entry, { openHash: hash, openHeight: height, onChain: snapshotWindow(onChain) });
      record.transactions.push({
        hash,
        tier: "pqc",
        note: `${AGENT_NAME} opens its own EVM window ${w.label} (hybrid ML-DSA-87): ${w.maxTxs} tx, ${w.maxValueUqor} uqor, ${w.blocks} blocks, targets PayGate`,
      });
      // W1 must still be live; W2 is short and may already be running down when it is read.
      const ok =
        onChain.found &&
        (w.label === "W2" || onChain.live) &&
        onChain.maxTxs === BigInt(w.maxTxs) &&
        onChain.maxValue === w.maxValueUqor &&
        onChain.allowedTargets.map((t) => t.toLowerCase()).join() === w.targets.map((t) => t.toLowerCase()).join();
      record.steps.push({ id: step.id, expect: step.expect, asExpected: ok, height, hash, note: step.description });
      console.log(`opened ${w.label}: ${hash} (height ${height}), expiry ${onChain.expiryHeight}`);
      if (!ok) fail(step, `window on chain does not match: ${JSON.stringify(snapshotWindow(onChain))}`);
    } else if (step.kind === "wait") {
      const w = await fetchEvmWindow({ rest: TESTNET.rest, address: agent.cosmos });
      const deadline = Date.now() + 120_000;
      let height = await latestHeight();
      while (height <= w.expiryHeight + 1n) {
        if (Date.now() > deadline) fail(step, `height ${height} did not pass ${w.expiryHeight}`);
        await new Promise((r) => setTimeout(r, 1500));
        height = await latestHeight();
      }
      record.steps.push({ id: step.id, expect: step.expect, asExpected: true, height: height.toString(), note: `expiry height ${w.expiryHeight}` });
      console.log(`height ${height} is past W2's expiry ${w.expiryHeight}`);
    } else if (step.kind === "probe") {
      const probe = step.probe!;
      const [window, height, balance] = await Promise.all([
        fetchEvmWindow({ rest: TESTNET.rest, address: agent.cosmos }),
        latestHeight(),
        uqorBalance(agent.cosmos),
      ]);
      const failures = preconditionFailures(probe, window, { height, agentBalanceUqor: balance, gas });
      if (failures.length > 0) fail(step, `preconditions failed, not sent: ${failures.join("; ")}`);
      const nonce = await client.getTransactionCount({ address: signer.address, blockTag: "pending" });
      const serialized = await signer.signTransaction({
        chainId: 9800,
        type: "eip1559",
        nonce,
        to: probe.to,
        data: probe.data,
        value: probe.valueUqor * UQOR_WEI,
        gas: gas.gas,
        maxFeePerGas: gas.maxFeePerGas,
        maxPriorityFeePerGas: gas.maxFeePerGas,
      });
      const signedHash = keccak256(serialized);
      const submission = await submitRawTransaction(TESTNET.evmRpc, serialized);
      let status: "success" | "reverted" | undefined;
      let landedHeight: string | undefined;
      if (submission.kind === "accepted") {
        const receipt = await client.waitForTransactionReceipt({ hash: submission.hash, timeout: 90_000 });
        status = receipt.status;
        landedHeight = receipt.blockNumber.toString();
      }
      const result = classifySubmission(submission, status);
      const ok = asExpected(probe, result);
      const base = {
        id: step.id,
        ...(probe.limit ? { limit: probe.limit } : {}),
        expect: step.expect,
        asExpected: ok,
        height: landedHeight ?? height.toString(),
        signedHash,
        windowBefore: snapshotWindow(window),
        note: probe.description,
      };
      if (result.outcome === "landed" || result.outcome === "included-failed") {
        record.steps.push({ ...base, hash: result.hash });
        record.transactions.push({
          hash: result.hash,
          tier: result.outcome === "landed" ? "classical" : "refused",
          note:
            result.outcome === "landed"
              ? `${AGENT_NAME} inside its own window ${probe.window}: ${probe.description}`
              : `UNEXPECTED: ${probe.id} was included and failed; the window admitted it`,
        });
        console.log(`${result.outcome}: ${result.hash} (block ${landedHeight})`);
      } else {
        const chainError = { code: result.code, message: result.message };
        const windowRejection = result.outcome === "refused-before-block" ? result.windowRejection : null;
        record.steps.push({ ...base, chainError, windowRejection });
        if (result.outcome === "refused-before-block" && probe.limit) {
          record.noHashRefusals.push({
            step: probe.id,
            limit: probe.limit,
            signedHash,
            chainError,
            windowRejection,
            height: height.toString(),
            note: probe.description,
          });
        }
        console.log(`${result.outcome} at height ${height}: [${result.code}] ${result.message}`);
      }
      save(record);
      if (!ok) fail(step, `expected ${probe.expect}, got ${result.outcome}`);
    }
    save(record);
  }
  record.status = "complete";
  record.recordedAt = new Date().toISOString();
  save(record);
  console.log(`\nAll steps as expected. Recorded in ${OUT}; re-check with npm run evidence.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
