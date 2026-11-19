import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  classicalKeyFromPrivate,
  createSiwqMessage,
  signSiwq,
  verifySiwq,
} from "@qorechain/qoresign";
import { fetchAuthenticators, fetchSpendingRules } from "@qorechain/sdk";
import { TESTNET } from "haven-pq-kit";
import { encodeFunctionData, hexToBytes, toHex, type Address, type Hex } from "viem";
import { QoreChainExecutor, StateStore } from "../agent/executor.js";
import { FileInboxAdapter } from "../agent/inbox.js";
import { createDefaultPlanner } from "../agent/planner.js";
import { ReceiptStore } from "../agent/receipt-store.js";
import { AllowlistedRelayer } from "../agent/relayer.js";
import { StewardAgent } from "../agent/runner.js";
import {
  createSealedMandate,
  type MandatePayload,
  type SealedMandate,
} from "../src/ts/mandate.js";
import {
  ACTION_APPROVE,
  ACTION_PAUSE,
  ACTION_PROPOSE,
  ACTION_UNPAUSE,
  ERC20_ABI,
  FUSD_ADDRESS,
  PAYGATE_ABI,
  PayGateOp,
  ZERO_BYTES32,
  approveArgsHash,
  encodeAddVendorParams,
  encodePayGateOwnerMessage,
  opHashOf,
} from "../src/ts/paygate.js";
import { signAuth } from "haven-pq-kit";
import {
  ensureAccount,
  evmClient,
  loadAccount,
  loadSealKeys,
  registerKem,
  registerMlDsa,
  sendScopedContractTx,
  withEvmWindow,
} from "./lib/chain.js";

function loadDeployment() {
  const path = "deployments/paygate.json";
  if (!existsSync(path)) throw new Error("missing deployments/paygate.json; run npm run deploy first");
  return JSON.parse(readFileSync(path, "utf8")) as {
    payGate: Address;
    token: Address;
    ownerCosmos: string;
    ownerEvm: Address;
    agentEvm: Address;
    timelockDelay: string;
    dailyCap: string;
    transactions: { hash: string; tier: string; note: string }[];
  };
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  const ownerName = process.env.STEWARD_OWNER ?? "spike";
  const agentName = process.env.STEWARD_AGENT ?? "steward-agent";
  const vendorName = process.env.STEWARD_VENDOR ?? "steward-vendor";

  if (!cmd || cmd === "--help") {
    console.log(
      [
        "Usage: npm run cli -- <command>",
        "  init                                      create owner/agent/vendor secrets if missing",
        "  register <name>                           register ML-DSA-87 + ML-KEM-1024 on testnet",
        "  mandate <vendorEvm> <budgetBase> <perInv> create signed+sealed Mandate for agent",
        "  vendor add <vendorEvm> <payout> <cap>     propose AddVendor on PayGate (ML-DSA PqAuth)",
        "  vendor exec <vendorEvm> <payout> <cap>    execute AddVendor after timelock",
        "  approve-queued <vendorEvm> <invoiceId>    owner ML-DSA approval of a queued invoice",
        "  pause | resume                            SIWQ off-chain agent pause/resume (no tx)",
        "  pause-gate | resume-gate                  on-chain PayGate.pause/unpause (ML-DSA PqAuth)",
        "  status                                    show PayGate, rules, and local agent state",
        "  run                                       process inbox/ once with StewardAgent",
      ].join("\n"),
    );
    return;
  }

  if (cmd === "init") {
    await ensureAccount(ownerName);
    await ensureAccount(agentName);
    await ensureAccount(vendorName);
    return;
  }

  if (cmd === "register") {
    const target = args[0] ?? ownerName;
    await registerMlDsa(target);
    await registerKem(target);
    return;
  }

  if (cmd === "mandate") {
    const [vendorAddr, budgetStr = "5000000000", maxPerInvStr = "1000000000"] = args;
    if (!vendorAddr) throw new Error("usage: mandate <vendorEvm> [budgetBase] [perInvoiceBase]");
    const dep = loadDeployment();
    const owner = await loadAccount(ownerName);
    const agent = await loadAccount(agentName);
    const agentSeal = loadSealKeys(agentName);
    const now = Math.floor(Date.now() / 1000);
    const payload: MandatePayload = {
      version: 1,
      mandateId: `mandate-${now}`,
      chainId: TESTNET.chainId,
      gate: dep.payGate,
      ownerCosmos: owner.cosmos,
      ownerEvm: owner.evm as Address,
      agentCosmos: agent.cosmos,
      agentReceiptPubkeyHex: toHex(agent.pqc.publicKey),
      budgetTotal: budgetStr,
      maxPerInvoice: maxPerInvStr,
      allowedVendors: [vendorAddr as Address],
      payBeforeDueHours: 0,
      allowPastDue: false,
      issuedAt: now - 10,
      expiresAt: now + 7 * 86400,
    };
    const sealed = createSealedMandate({
      payload,
      ownerClassicalKey: classicalKeyFromPrivate(hexToBytes(owner.privateKey as Hex), "eth_secp256k1"),
      ownerPqSecretKey: owner.pqc.secretKey,
      agentRecipient: { mlkemPublicKey: agentSeal.mlkemPublicKey, x25519PublicKey: agentSeal.x25519PublicKey },
    });
    mkdirSync("agent-state", { recursive: true });
    writeFileSync("agent-state/mandate.json", `${JSON.stringify(sealed, null, 2)}\n`);
    console.log(`wrote signed & sealed mandate ${payload.mandateId} -> agent-state/mandate.json`);
    return;
  }

  if (cmd === "vendor") {
    const sub = args[0];
    const [vendorAddr, payoutAddr, capStr = "1000000000"] = args.slice(1);
    if (!sub || !vendorAddr || !payoutAddr) {
      throw new Error("usage: vendor <add|exec> <vendorEvm> <payoutEvm> [capBase]");
    }
    const dep = loadDeployment();
    const owner = await loadAccount(ownerName);
    const client = evmClient();
    const params = encodeAddVendorParams(vendorAddr as Address, payoutAddr as Address, BigInt(capStr));
    if (sub === "add") {
      const nonce = await client.readContract({ address: dep.payGate, abi: PAYGATE_ABI, functionName: "ownerNonce" });
      const deadline = BigInt(Math.floor(Date.now() / 1000)) + 3600n;
      const opHash = opHashOf(PayGateOp.AddVendor, params);
      const { signature } = signAuth(owner.pqc.secretKey, {
        chainId: BigInt(TESTNET.evmChainId),
        contract: dep.payGate,
        signer: owner.evm as Address,
        action: ACTION_PROPOSE,
        nonce,
        deadline,
        argsHash: opHash,
      });
      const data = encodeFunctionData({
        abi: PAYGATE_ABI,
        functionName: "propose",
        args: [PayGateOp.AddVendor, params, deadline, signature],
      });
      const { result } = await withEvmWindow(
        ownerName,
        { txs: 1, maxValueUqor: "2000000", targets: [dep.payGate] },
        async (acc) => sendScopedContractTx({ account: acc, to: dep.payGate, data }),
      );
      console.log(`proposed AddVendor opHash=${opHash} tx=${result}`);
      return;
    }
    if (sub === "exec") {
      const data = encodeFunctionData({
        abi: PAYGATE_ABI,
        functionName: "execute",
        args: [PayGateOp.AddVendor, params],
      });
      const { result } = await withEvmWindow(
        ownerName,
        { txs: 1, maxValueUqor: "2000000", targets: [dep.payGate] },
        async (acc) => sendScopedContractTx({ account: acc, to: dep.payGate, data }),
      );
      console.log(`executed AddVendor tx=${result}`);
      return;
    }
    throw new Error(`unknown vendor subcommand ${sub}`);
  }

  if (cmd === "approve-queued") {
    const [vendorAddr, invoiceId] = args;
    if (!vendorAddr || !invoiceId) throw new Error("usage: approve-queued <vendorEvm> <invoiceIdHex>");
    const dep = loadDeployment();
    const owner = await loadAccount(ownerName);
    const client = evmClient();
    const key = await client.readContract({
      address: dep.payGate,
      abi: PAYGATE_ABI,
      functionName: "invoiceKey",
      args: [vendorAddr as Address, invoiceId as Hex],
    });
    const [payee, amount] = await client.readContract({
      address: dep.payGate,
      abi: PAYGATE_ABI,
      functionName: "queued",
      args: [key],
    });
    const nonce = await client.readContract({ address: dep.payGate, abi: PAYGATE_ABI, functionName: "ownerNonce" });
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + 3600n;
    const argsHash = approveArgsHash(vendorAddr as Address, invoiceId as Hex, payee, amount);
    const { signature } = signAuth(owner.pqc.secretKey, {
      chainId: BigInt(TESTNET.evmChainId),
      contract: dep.payGate,
      signer: owner.evm as Address,
      action: ACTION_APPROVE,
      nonce,
      deadline,
      argsHash,
    });
    const data = encodeFunctionData({
      abi: PAYGATE_ABI,
      functionName: "approveQueued",
      args: [vendorAddr as Address, invoiceId as Hex, deadline, signature],
    });
    const { result } = await withEvmWindow(
      ownerName,
      { txs: 1, maxValueUqor: "2000000", targets: [dep.payGate] },
      async (acc) => sendScopedContractTx({ account: acc, to: dep.payGate, data }),
    );
    console.log(`approved queued invoice ${invoiceId} tx=${result}`);
    return;
  }

  if (cmd === "pause" || cmd === "resume") {
    const owner = await loadAccount(ownerName);
    const state = new StateStore();
    const nonce = `siwq-${Date.now()}`;
    const msg = createSiwqMessage({
      domain: "steward.haven.local",
      address: owner.cosmos,
      statement: cmd === "pause" ? "Pause Steward agent locally" : "Resume Steward agent locally",
      uri: "https://steward.haven.local/control",
      chainId: TESTNET.chainId,
      nonce,
      issuedAt: new Date().toISOString(),
    });
    const sig = signSiwq({
      message: msg,
      classicalKey: classicalKeyFromPrivate(hexToBytes(owner.privateKey as Hex), "eth_secp256k1"),
      pqKey: { secretKey: owner.pqc.secretKey },
    });
    verifySiwq({
      message: msg,
      signature: sig,
      domain: "steward.haven.local",
      nonce,
      chainId: TESTNET.chainId,
      pqPublicKey: owner.pqc.publicKey,
    });
    state.data.locallyPaused = cmd === "pause";
    state.save();
    console.log(`agent ${cmd}d via SIWQ (no on-chain transaction)`);
    return;
  }

  if (cmd === "pause-gate" || cmd === "resume-gate") {
    const dep = loadDeployment();
    const owner = await loadAccount(ownerName);
    const client = evmClient();
    const nonce = await client.readContract({ address: dep.payGate, abi: PAYGATE_ABI, functionName: "ownerNonce" });
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + 3600n;
    const action = cmd === "pause-gate" ? ACTION_PAUSE : ACTION_UNPAUSE;
    const { signature } = signAuth(owner.pqc.secretKey, {
      chainId: BigInt(TESTNET.evmChainId),
      contract: dep.payGate,
      signer: owner.evm as Address,
      action,
      nonce,
      deadline,
      argsHash: ZERO_BYTES32,
    });
    const data = encodeFunctionData({
      abi: PAYGATE_ABI,
      functionName: cmd === "pause-gate" ? "pause" : "unpause",
      args: [deadline, signature],
    });
    const { result } = await withEvmWindow(
      ownerName,
      { txs: 1, maxValueUqor: "2000000", targets: [dep.payGate] },
      async (acc) => sendScopedContractTx({ account: acc, to: dep.payGate, data }),
    );
    console.log(`PayGate ${cmd} tx=${result}`);
    return;
  }

  if (cmd === "status") {
    const dep = loadDeployment();
    const client = evmClient();
    const [owner, agent, paused, dailyCap, spentToday, balance, rules, auths] = await Promise.all([
      client.readContract({ address: dep.payGate, abi: PAYGATE_ABI, functionName: "owner" }),
      client.readContract({ address: dep.payGate, abi: PAYGATE_ABI, functionName: "agent" }),
      client.readContract({ address: dep.payGate, abi: PAYGATE_ABI, functionName: "paused" }),
      client.readContract({ address: dep.payGate, abi: PAYGATE_ABI, functionName: "dailyCap" }),
      client.readContract({ address: dep.payGate, abi: PAYGATE_ABI, functionName: "spentToday" }),
      client.readContract({ address: FUSD_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [dep.payGate] }),
      fetchSpendingRules({ rest: TESTNET.rest, address: dep.ownerCosmos }).catch(() => ({ rules: [] })),
      fetchAuthenticators({ rest: TESTNET.rest, address: dep.ownerCosmos }).catch(() => []),
    ]);
    const state = new StateStore();
    console.log(
      JSON.stringify(
        {
          payGate: dep.payGate,
          owner,
          agent,
          paused,
          dailyCap: dailyCap.toString(),
          spentToday: spentToday.toString(),
          fusdBalance: balance.toString(),
          spendingRules: rules.rules,
          authenticatorsCount: auths.length,
          localState: state.data,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === "run") {
    const dep = loadDeployment();
    if (!existsSync("agent-state/mandate.json")) throw new Error("missing agent-state/mandate.json; run mandate first");
    const sealed = JSON.parse(readFileSync("agent-state/mandate.json", "utf8")) as SealedMandate;
    const owner = await loadAccount(ownerName);
    const agent = await loadAccount(agentName);
    const agentSeal = loadSealKeys(agentName);
    const client = evmClient();
    const state = new StateStore();
    const receipts = new ReceiptStore("agent-state/receipts.jsonl", agent.pqc.publicKey);
    const relayer = new AllowlistedRelayer({
      relayerAccount: owner,
      expectedOwnerCosmos: owner.cosmos,
      allowedGate: dep.payGate,
    });
    const executor = new QoreChainExecutor({
      publicClient: client,
      gate: dep.payGate,
      ownerCosmos: owner.cosmos,
      agentKey: agent,
      relayer,
      state,
    });
    const runner = new StewardAgent({
      chainId: TESTNET.chainId,
      evmChainId: BigInt(TESTNET.evmChainId),
      gate: dep.payGate,
      ownerCosmos: owner.cosmos,
      ownerEvm: owner.evm as Address,
      agentAccount: agent,
      agentSealKeys: agentSeal,
      publicClient: client,
      planner: createDefaultPlanner(),
      executor,
      state,
      receipts,
    });
    const mandate = await runner.loadMandate(sealed);
    const out = await runner.drainInbox(new FileInboxAdapter("inbox"), mandate);
    console.log(`processed ${out.length} invoice(s)`);
    for (const r of out) {
      console.log(`  seq=${r.body.seq} action=${r.body.finalAction} code=${r.body.decisionCode} tx=${r.body.txHash ?? "-"}`);
    }
    return;
  }

  throw new Error(`unknown command: ${cmd}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
