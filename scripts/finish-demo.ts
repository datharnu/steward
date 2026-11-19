/**
 * Demo steps 5 and 7, now that the owner can pay for an EVM window.
 *
 * 5. Queue a vendor-signed invoice over the 20,000 cap, then the owner
 *    approves it with ML-DSA. The gate must hold enough fUSD to pay it.
 * 7. The owner pauses PayGate, then unpauses it. The gate is not left paused.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pqcSign } from "@qorechain/sdk";
import { encodeInvoice, signAuth, TESTNET } from "haven-pq-kit";
import { encodeFunctionData, hexToBytes, keccak256, toBytes, toHex, type Address, type Hex } from "viem";
import { QoreChainExecutor, StateStore } from "../agent/executor.js";
import { AllowlistedRelayer } from "../agent/relayer.js";
import {
  ACTION_APPROVE,
  ACTION_PAUSE,
  ACTION_UNPAUSE,
  FUSD_ADDRESS,
  PAYGATE_ABI,
  ZERO_BYTES32,
  approveArgsHash,
} from "../src/ts/paygate.js";
import { clampDecision, type InvoiceRecord } from "../src/ts/policy.js";
import { evmClient, loadAccount, sendScopedContractTx, withEvmWindow } from "./lib/chain.js";

const DEPLOYMENT = "deployments/paygate.json";
const AMOUNT = 25_000n;

type Deployment = {
  payGate: Address;
  ownerCosmos: string;
  transactions: { hash: string; tier: string; note: string }[];
};

function record(deployment: Deployment, hash: string | undefined, tier: string, note: string): void {
  if (!hash) throw new Error(`no hash for ${note}`);
  deployment.transactions.push({ hash, tier, note });
  writeFileSync(DEPLOYMENT, `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`${note} ${hash}`);
}

async function main(): Promise<void> {
  const deployment = JSON.parse(readFileSync(DEPLOYMENT, "utf8")) as Deployment;
  const owner = await loadAccount("spike");
  const agent = await loadAccount("steward-agent");
  const vendor = await loadAccount("steward-vendor");
  const client = evmClient();
  const gate = deployment.payGate;
  const now = Math.floor(Date.now() / 1000);
  const vendorAddr = vendor.evm as Address;

  const [balance, paused, capRow] = await Promise.all([
    client.readContract({ address: FUSD_ADDRESS, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }] as const, functionName: "balanceOf", args: [gate] }),
    client.readContract({ address: gate, abi: PAYGATE_ABI, functionName: "paused" }),
    client.readContract({ address: gate, abi: PAYGATE_ABI, functionName: "vendors", args: [vendorAddr] }),
  ]);
  const perInvoiceCap = capRow[2];
  console.log(`gate holds ${balance}, cap ${perInvoiceCap}, paused ${paused}`);
  if (paused) throw new Error("PayGate is already paused");
  if (balance < AMOUNT) throw new Error(`gate holds ${balance}, which cannot pay ${AMOUNT}`);
  if (AMOUNT <= perInvoiceCap) throw new Error(`${AMOUNT} is not over the cap ${perInvoiceCap}`);

  const memo = "over the per-invoice cap, for the owner to approve";
  const invoiceId = keccak256(toBytes("steward-demo-overcap"));
  const message = encodeInvoice({
    chainId: BigInt(TESTNET.evmChainId),
    gate,
    vendor: vendorAddr,
    payee: vendorAddr,
    token: FUSD_ADDRESS,
    amount: AMOUNT,
    invoiceId,
    dueDate: BigInt(now + 86400),
    memoHash: keccak256(toBytes(memo)),
  });
  const invoice: InvoiceRecord = {
    vendor: vendorAddr,
    payee: vendorAddr,
    token: FUSD_ADDRESS,
    amount: AMOUNT.toString(),
    invoiceId,
    dueDate: now + 86400,
    memoHash: keccak256(toBytes(memo)),
    memoText: memo,
    vendorSig: toHex(pqcSign(vendor.pqc.secretKey, hexToBytes(message))),
  };
  const decision = clampDecision({
    invoice,
    vendorSigValid: true,
    mandate: {
      version: 1,
      mandateId: "steward-demo",
      chainId: TESTNET.chainId,
      gate,
      ownerCosmos: deployment.ownerCosmos,
      ownerEvm: owner.evm as Address,
      agentCosmos: deployment.ownerCosmos,
      budgetTotal: perInvoiceCap.toString(),
      maxPerInvoice: perInvoiceCap.toString(),
      allowedVendors: [vendorAddr],
      payBeforeDueHours: 0,
      allowPastDue: true,
      issuedAt: now - 10,
      expiresAt: now + 86400,
    },
    mandateBudgetSpent: 0n,
    gate: {
      gateAddress: gate,
      tokenAddress: FUSD_ADDRESS,
      paused: false,
      dailyCap: 2_500_000_000n,
      spentToday: 10_000n,
      gateBalance: balance,
      vendor: { active: capRow[0], payout: capRow[1], perInvoiceCap, epoch: capRow[3] },
      invoiceState: 0,
    },
    agentLocallyPaused: false,
    proposal: { action: "pay", reason: "the planner asked to pay" },
    nowUnix: now,
  });
  if (decision.code !== "OK_QUEUE" || !decision.willExecuteOnChain) {
    throw new Error(`policy did not queue the over-cap invoice: ${decision.code} ${decision.reason}`);
  }
  console.log(`policy ${decision.code}: ${decision.reason}`);

  const executor = new QoreChainExecutor({
    publicClient: client,
    gate,
    ownerCosmos: deployment.ownerCosmos,
    agentKey: agent,
    state: new StateStore("agent-state/overcap-state.json"),
    relayer: new AllowlistedRelayer({
      relayerAccount: owner,
      expectedOwnerCosmos: deployment.ownerCosmos,
      allowedGate: gate,
    }),
  });
  const queued = await executor.execute("queue", invoice, "steward-demo");
  if (queued.status !== "confirmed") throw new Error(`queue did not land: ${queued.status} ${queued.reason ?? ""} ${queued.txHash ?? ""}`);
  record(deployment, queued.txHash, "pqc", "queue a 25,000 invoice, over the 20,000 per-invoice cap");

  const key = await client.readContract({
    address: gate,
    abi: PAYGATE_ABI,
    functionName: "invoiceKey",
    args: [vendorAddr, invoiceId],
  });
  const state = Number(await client.readContract({ address: gate, abi: PAYGATE_ABI, functionName: "invoiceState", args: [key] }));
  if (state !== 1) throw new Error(`queued invoice state is ${state}, expected 1`);

  const approved = await withEvmWindow( "spike", { txs: 1, maxValueUqor: "2000000", targets: [gate] }, async (acc) => {
    const [payee, amount] = await client.readContract({ address: gate, abi: PAYGATE_ABI, functionName: "queued", args: [key] });
    const nonce = await client.readContract({ address: gate, abi: PAYGATE_ABI, functionName: "ownerNonce" });
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + 3600n;
    const { signature } = signAuth(owner.pqc.secretKey, {
      chainId: BigInt(TESTNET.evmChainId),
      contract: gate,
      signer: owner.evm as Address,
      action: ACTION_APPROVE,
      nonce,
      deadline,
      argsHash: approveArgsHash(vendorAddr, invoiceId, payee, amount),
    });
    const data = encodeFunctionData({
      abi: PAYGATE_ABI,
      functionName: "approveQueued",
      args: [vendorAddr, invoiceId, deadline, signature],
    });
    return sendScopedContractTx({ account: acc, to: gate, data });
  });
  record(deployment, approved.openHash, "pqc", "open the window for the over-cap approval");
  record(deployment, approved.result, "classical", "owner ML-DSA approveQueued of the 25,000 invoice");
  record(deployment, approved.closeHash, "pqc", "close the over-cap approval window");

  const paid = Number(await client.readContract({ address: gate, abi: PAYGATE_ABI, functionName: "invoiceState", args: [key] }));
  if (paid !== 2) throw new Error(`approved invoice state is ${paid}, expected 2`);

  let pausedNow = false;
  try {
    const pause = await withEvmWindow("spike", { txs: 1, maxValueUqor: "2000000", targets: [gate] }, async (acc) => {
      const nonce = await client.readContract({ address: gate, abi: PAYGATE_ABI, functionName: "ownerNonce" });
      const deadline = BigInt(Math.floor(Date.now() / 1000)) + 3600n;
      const { signature } = signAuth(owner.pqc.secretKey, {
        chainId: BigInt(TESTNET.evmChainId),
        contract: gate,
        signer: owner.evm as Address,
        action: ACTION_PAUSE,
        nonce,
        deadline,
        argsHash: ZERO_BYTES32,
      });
      const data = encodeFunctionData({ abi: PAYGATE_ABI, functionName: "pause", args: [deadline, signature] });
      return sendScopedContractTx({ account: acc, to: gate, data });
    });
    record(deployment, pause.openHash, "pqc", "open the window to pause PayGate");
    record(deployment, pause.result, "classical", "owner ML-DSA pause of PayGate");
    record(deployment, pause.closeHash, "pqc", "close the pause window");
    pausedNow = Boolean(await client.readContract({ address: gate, abi: PAYGATE_ABI, functionName: "paused" }));
    if (!pausedNow) throw new Error("pause transaction landed but PayGate is not paused");
  } finally {
    if (pausedNow) {
      const resume = await withEvmWindow("spike", { txs: 1, maxValueUqor: "2000000", targets: [gate] }, async (acc) => {
        const nonce = await client.readContract({ address: gate, abi: PAYGATE_ABI, functionName: "ownerNonce" });
        const deadline = BigInt(Math.floor(Date.now() / 1000)) + 3600n;
        const { signature } = signAuth(owner.pqc.secretKey, {
          chainId: BigInt(TESTNET.evmChainId),
          contract: gate,
          signer: owner.evm as Address,
          action: ACTION_UNPAUSE,
          nonce,
          deadline,
          argsHash: ZERO_BYTES32,
        });
        const data = encodeFunctionData({ abi: PAYGATE_ABI, functionName: "unpause", args: [deadline, signature] });
        return sendScopedContractTx({ account: acc, to: gate, data });
      });
      record(deployment, resume.openHash, "pqc", "open the window to unpause PayGate");
      record(deployment, resume.result, "classical", "owner ML-DSA unpause of PayGate");
      record(deployment, resume.closeHash, "pqc", "close the unpause window");
      const still = Boolean(await client.readContract({ address: gate, abi: PAYGATE_ABI, functionName: "paused" }));
      if (still) throw new Error("PayGate is still paused");
      console.log("PayGate is unpaused");
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
