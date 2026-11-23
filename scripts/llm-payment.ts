/**
 * One live payment planned by a real LLM (no rule-based fallback).
 *
 * The vendor (already active on PayGate from first-payment.ts) signs a fresh invoice, the
 * owner seals a fresh off-chain mandate, and StewardAgent runs with ClaudePlanner in strict
 * mode: if the model gives no usable answer, the script stops and nothing is paid. The
 * resulting receipt's `planner` field names the provider and model.
 *
 *   npm run llm-payment -- --dry-run            checks gate/vendor/balance, signs nothing on chain
 *   npm run llm-payment                         pays invoice "steward-llm-1" (10,000 base units)
 *   npm run llm-payment -- --id steward-llm-2 --amount 5000 --provider openrouter --model nvidia/nemotron-3.5-super-vl:free
 *
 * Provider/model come from loadLlmCredentials() (STEWARD_LLM_PROVIDER, *_API_KEY, *_MODEL).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pqcSign } from "@qorechain/sdk";
import { encodeInvoice, TESTNET } from "haven-pq-kit";
import { hexToBytes, keccak256, toBytes, toHex, type Address, type Hex } from "viem";
import { QoreChainExecutor, StateStore } from "../agent/executor.js";
import { FileInboxAdapter } from "../agent/inbox.js";
import { ClaudePlanner, loadLlmCredentials } from "../agent/planner.js";
import { ReceiptStore } from "../agent/receipt-store.js";
import { AllowlistedRelayer } from "../agent/relayer.js";
import { StewardAgent } from "../agent/runner.js";
import { createSealedMandate, type MandatePayload } from "../src/ts/mandate.js";
import { ERC20_ABI, FUSD_ADDRESS, PAYGATE_ABI } from "../src/ts/paygate.js";
import { evmClient, loadAccount, loadSealKeys } from "./lib/chain.js";
import { applyLlmFlags } from "./lib/llm-flags.js";

const CAP = 20_000n;

function parseArgs(argv: string[]): { id: string; amount: bigint; dryRun: boolean; provider?: string; model?: string } {
  const out: { id: string; amount: bigint; dryRun: boolean; provider?: string; model?: string } = {
    id: "steward-llm-1",
    amount: 10_000n,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--id") out.id = argv[++i] ?? out.id;
    else if (a === "--amount") out.amount = BigInt(argv[++i] ?? "0");
    else if (a === "--provider") out.provider = argv[++i];
    else if (a === "--model") out.model = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  if (out.amount <= 0n || out.amount > CAP) throw new Error(`--amount must be 1..${CAP} (per-invoice cap)`);
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  applyLlmFlags(args.provider, args.model);
  const creds = loadLlmCredentials();
  if (!creds) throw new Error("no LLM key: set ANTHROPIC_API_KEY or OPENROUTER_API_KEY (see README)");

  const deploymentPath = "deployments/paygate.json";
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf8")) as {
    payGate: Address;
    transactions: { hash: string; tier: string; note: string }[];
  };
  const gate = deployment.payGate;
  const owner = await loadAccount("spike");
  const agent = await loadAccount("steward-agent");
  const vendor = await loadAccount("steward-vendor");
  const client = evmClient();

  const v = await client.readContract({ address: gate, abi: PAYGATE_ABI, functionName: "vendors", args: [vendor.evm as Address] });
  if (!v[0]) throw new Error(`vendor ${vendor.evm} is not active on PayGate; run first-payment.ts first`);
  const balance = (await client.readContract({
    address: FUSD_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [gate],
  })) as bigint;
  const invoiceId = keccak256(toBytes(args.id));
  console.log(`planner   llm:${creds.provider}:${creds.model} (strict, no rule-based fallback)`);
  console.log(`gate      ${gate} balance ${balance} fUSD base units`);
  console.log(`invoice   "${args.id}" ${invoiceId} amount ${args.amount} to registered payout ${vendor.evm}`);
  if (balance < args.amount) throw new Error(`gate holds ${balance}, less than ${args.amount}`);
  if (args.dryRun) {
    console.log("dry run: nothing signed or sent");
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: MandatePayload = {
    version: 1,
    mandateId: `mandate-${args.id}`,
    chainId: TESTNET.chainId,
    gate,
    ownerCosmos: owner.cosmos,
    ownerEvm: owner.evm as Address,
    agentCosmos: agent.cosmos,
    agentReceiptPubkeyHex: toHex(agent.pqc.publicKey),
    budgetTotal: CAP.toString(),
    maxPerInvoice: CAP.toString(),
    allowedVendors: [vendor.evm as Address],
    payBeforeDueHours: 0,
    allowPastDue: false,
    issuedAt: now - 10,
    expiresAt: now + 7 * 86400,
  };
  const sealed = createSealedMandate({
    payload,
    ownerClassicalKey: (await import("@qorechain/qoresign")).classicalKeyFromPrivate(hexToBytes(owner.privateKey as Hex), "eth_secp256k1"),
    ownerPqSecretKey: owner.pqc.secretKey,
    agentRecipient: loadSealKeys("steward-agent"),
  });
  mkdirSync("agent-state", { recursive: true });
  writeFileSync(`agent-state/mandate-${args.id}.json`, `${JSON.stringify(sealed, null, 2)}\n`);

  const memoText = `Monthly hosting, ${new Date(now * 1000).toISOString().slice(0, 7)}`;
  const memoHash = keccak256(toBytes(memoText));
  const message = encodeInvoice({
    chainId: BigInt(TESTNET.evmChainId),
    gate,
    vendor: vendor.evm as Address,
    payee: vendor.evm as Address,
    token: FUSD_ADDRESS,
    amount: args.amount,
    invoiceId,
    dueDate: BigInt(now + 86400),
    memoHash,
  });
  const vendorSig = toHex(pqcSign(vendor.pqc.secretKey, hexToBytes(message)));
  const inboxDir = "inbox-llm";
  mkdirSync(inboxDir, { recursive: true });
  writeFileSync(
    `${inboxDir}/${args.id}.json`,
    `${JSON.stringify(
      {
        vendor: vendor.evm,
        payee: vendor.evm,
        token: FUSD_ADDRESS,
        amount: args.amount.toString(),
        invoiceId,
        dueDate: now + 86400,
        memoHash,
        memoText,
        vendorSig,
      },
      null,
      2,
    )}\n`,
  );

  const exchanges: unknown[] = [];
  const planner = new ClaudePlanner(creds, { fallback: false, onExchange: (e) => exchanges.push(e) });
  const state = new StateStore();
  const receipts = new ReceiptStore("agent-state/receipts.jsonl", agent.pqc.publicKey);
  const runner = new StewardAgent({
    chainId: TESTNET.chainId,
    evmChainId: BigInt(TESTNET.evmChainId),
    gate,
    ownerCosmos: owner.cosmos,
    ownerEvm: owner.evm as Address,
    agentAccount: agent,
    agentSealKeys: loadSealKeys("steward-agent"),
    publicClient: client,
    planner,
    executor: new QoreChainExecutor({
      publicClient: client,
      gate,
      ownerCosmos: owner.cosmos,
      agentKey: agent,
      relayer: new AllowlistedRelayer({ relayerAccount: owner, expectedOwnerCosmos: owner.cosmos, allowedGate: gate }),
      state,
    }),
    state,
    receipts,
  });
  const mandate = await runner.loadMandate(sealed);
  const out = await runner.drainInbox(new FileInboxAdapter(inboxDir), mandate);

  mkdirSync("transcripts", { recursive: true });
  const transcriptPath = `transcripts/llm-payment-${args.id}.json`;
  writeFileSync(
    transcriptPath,
    `${JSON.stringify({ kind: "llm-payment", ranAt: new Date().toISOString(), invoiceId: args.id, exchanges, receipts: out.map((r) => r.body) }, (_k, val) => (typeof val === "bigint" ? val.toString() : val), 2)}\n`,
  );
  for (const receipt of out) {
    console.log(
      `receipt   seq=${receipt.body.seq} planner=${receipt.body.planner ?? "-"} ${receipt.body.finalAction} ${receipt.body.decisionCode} tx=${receipt.body.txHash ?? "-"}`,
    );
    if (receipt.body.txHash) {
      deployment.transactions.push({
        hash: receipt.body.txHash,
        tier: "pqc",
        note: `agent ${receipt.body.finalAction} ${receipt.body.decisionCode} (planner ${receipt.body.planner ?? "?"})`,
      });
    }
  }
  writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`transcript ${transcriptPath}`);
  if (out.length === 0) throw new Error("the agent processed no invoice");
  if (out.some((receipt) => receipt.body.decisionCode !== "OK_PAY" || !receipt.body.txHash)) {
    throw new Error("the invoice was not paid (see the receipt and transcript)");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
