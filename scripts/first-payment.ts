/**
 * The first live payment. A vendor registers an ML-DSA-87 key, the owner adds it
 * through the timelock, and the agent pays one signed invoice from the gate.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { msg, pqcSign } from "@qorechain/sdk";
import { encodeInvoice, signAuth, TESTNET } from "haven-pq-kit";
import { encodeFunctionData, hexToBytes, keccak256, toBytes, toHex, type Address, type Hex } from "viem";
import { QoreChainExecutor, StateStore } from "../agent/executor.js";
import { FileInboxAdapter } from "../agent/inbox.js";
import { createDefaultPlanner } from "../agent/planner.js";
import { ReceiptStore } from "../agent/receipt-store.js";
import { AllowlistedRelayer } from "../agent/relayer.js";
import { StewardAgent } from "../agent/runner.js";
import { createSealedMandate, type MandatePayload } from "../src/ts/mandate.js";
import { loadSealKeys } from "./lib/chain.js";
import {
  ACTION_PROPOSE,
  FUSD_ADDRESS,
  PAYGATE_ABI,
  PayGateOp,
  encodeAddVendorParams,
  opHashOf,
} from "../src/ts/paygate.js";
import {
  broadcast,
  ensureAccount,
  evmClient,
  loadAccount,
  registerMlDsa,
  sendScopedContractTx,
  withEvmWindow,
} from "./lib/chain.js";

const AMOUNT = 10_000n;
const CAP = 20_000n;

async function main(): Promise<void> {
  const deploymentPath = "deployments/paygate.json";
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf8")) as {
    payGate: Address;
    timelockDelay: string;
    transactions: { hash: string; tier: string; note: string }[];
  };
  const gate = deployment.payGate;
  const owner = await loadAccount("spike");
  const agent = await loadAccount("steward-agent");
  const vendor = await ensureAccount("steward-vendor");
  const client = evmClient();
  console.log(`vendor ${vendor.cosmos} ${vendor.evm}`);

  const vendorBal = (await fetch(`${TESTNET.rest}/cosmos/bank/v1beta1/balances/${vendor.cosmos}`).then((r) => r.json())) as {
    balances?: { denom: string; amount: string }[];
  };
  const uqor = BigInt(vendorBal.balances?.find((coin) => coin.denom === "uqor")?.amount ?? "0");
  if (uqor < 200_000n) {
    const funded = await broadcast(owner, [
      msg.bank.send({
        fromAddress: owner.cosmos,
        toAddress: vendor.cosmos,
        amount: [{ denom: "uqor", amount: "400000" }],
      }),
    ]);
    console.log(`funded vendor ${funded}`);
    deployment.transactions.push({ hash: funded, tier: "pqc", note: "fund the vendor account for key registration" });
  }
  const registered = await registerMlDsa("steward-vendor");
  if (registered) deployment.transactions.push({ hash: registered, tier: "enrollment", note: "vendor ML-DSA-87 registration" });

  const current = await client.readContract({ address: gate, abi: PAYGATE_ABI, functionName: "vendors", args: [vendor.evm as Address] });
  if (!current[0]) {
    const params = encodeAddVendorParams(vendor.evm as Address, vendor.evm as Address, CAP);
    const nonce = await client.readContract({ address: gate, abi: PAYGATE_ABI, functionName: "ownerNonce" });
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + 3600n;
    const { signature } = signAuth(owner.pqc.secretKey, {
      chainId: BigInt(TESTNET.evmChainId),
      contract: gate,
      signer: owner.evm as Address,
      action: ACTION_PROPOSE,
      nonce,
      deadline,
      argsHash: opHashOf(PayGateOp.AddVendor, params),
    });
    const proposeData = encodeFunctionData({
      abi: PAYGATE_ABI,
      functionName: "propose",
      args: [PayGateOp.AddVendor, params, deadline, signature],
    });
    const proposed = await withEvmWindow("spike", { txs: 1, maxValueUqor: "2000000", targets: [gate] }, (acc) =>
      sendScopedContractTx({ account: acc, to: gate, data: proposeData }),
    );
    console.log(`proposed vendor ${proposed.result}`);
    deployment.transactions.push({ hash: proposed.openHash, tier: "pqc", note: "open window to propose the vendor" });
    deployment.transactions.push({ hash: proposed.result, tier: "classical", note: "propose AddVendor" });
    deployment.transactions.push({ hash: proposed.closeHash, tier: "pqc", note: "close window after proposing the vendor" });
    const waitMs = (Number(deployment.timelockDelay) + 8) * 1000;
    console.log(`waiting ${waitMs / 1000}s for the timelock`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    const execData = encodeFunctionData({ abi: PAYGATE_ABI, functionName: "execute", args: [PayGateOp.AddVendor, params] });
    const executed = await withEvmWindow("spike", { txs: 1, maxValueUqor: "2000000", targets: [gate] }, (acc) =>
      sendScopedContractTx({ account: acc, to: gate, data: execData }),
    );
    console.log(`vendor active ${executed.result}`);
    deployment.transactions.push({ hash: executed.openHash, tier: "pqc", note: "open window to execute AddVendor" });
    deployment.transactions.push({ hash: executed.result, tier: "classical", note: "execute AddVendor" });
    deployment.transactions.push({ hash: executed.closeHash, tier: "pqc", note: "close window after AddVendor" });
  } else {
    console.log("vendor already active");
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: MandatePayload = {
    version: 1,
    mandateId: "mandate-first-payment",
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
  writeFileSync("agent-state/mandate.json", `${JSON.stringify(sealed, null, 2)}\n`);

  const invoiceId = keccak256(toBytes("steward-demo-1"));
  const memoHash = keccak256(toBytes("first live invoice"));
  const message = encodeInvoice({
    chainId: BigInt(TESTNET.evmChainId),
    gate,
    vendor: vendor.evm as Address,
    payee: vendor.evm as Address,
    token: FUSD_ADDRESS,
    amount: AMOUNT,
    invoiceId,
    dueDate: BigInt(now + 86400),
    memoHash,
  });
  const vendorSig = toHex(pqcSign(vendor.pqc.secretKey, hexToBytes(message)));
  mkdirSync("inbox", { recursive: true });
  writeFileSync(
    "inbox/first.json",
    `${JSON.stringify(
      {
        vendor: vendor.evm,
        payee: vendor.evm,
        token: FUSD_ADDRESS,
        amount: AMOUNT.toString(),
        invoiceId,
        dueDate: now + 86400,
        memoHash,
        memoText: "first live invoice",
        vendorSig,
      },
      null,
      2,
    )}\n`,
  );

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
    planner: createDefaultPlanner(),
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
  const out = await runner.drainInbox(new FileInboxAdapter("inbox"), mandate);
  for (const receipt of out) {
    console.log(`receipt seq=${receipt.body.seq} ${receipt.body.finalAction} ${receipt.body.decisionCode} tx=${receipt.body.txHash ?? "-"}`);
    if (receipt.body.txHash) {
      deployment.transactions.push({
        hash: receipt.body.txHash,
        tier: "pqc",
        note: `agent ${receipt.body.finalAction} ${receipt.body.decisionCode}`,
      });
    }
  }
  writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`);
  if (out.some((receipt) => receipt.body.decisionCode !== "OK_PAY" || !receipt.body.txHash)) {
    throw new Error("the invoice was not paid");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
