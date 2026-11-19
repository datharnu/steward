import { existsSync, readFileSync } from "node:fs";
import { TOOLS, toolContext } from "@qorechain/mcp";
import { type SignedReceipt, verifyReceiptChain } from "../src/ts/receipts.js";

/**
 * `npm run audit`: verifies the hash-chained ML-DSA-87 receipts in
 * `agent-state/receipts.jsonl` and checks every receipt with a transaction hash
 * on chain through `@qorechain/mcp`.
 */

function tool(name: string) {
  const found = TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`@qorechain/mcp has no ${name} tool`);
  return found;
}

const getTransaction = tool("get_transaction");
const getPqStatus = tool("get_pq_status");
const ctx = toolContext({ defaultNetwork: "testnet" });

type TxRes = { success: boolean; execution_failures?: unknown[] };
type PqRes = {
  transaction_status: {
    tier: string;
    has_exactly_one_pqc_layer: boolean;
    verification: { verified: boolean | null };
  } | null;
};

async function main(): Promise<void> {
  const path = process.argv[2] ?? "agent-state/receipts.jsonl";
  if (!existsSync(path)) {
    console.error(`no receipt log at ${path}`);
    process.exit(1);
  }
  const receipts = readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as SignedReceipt);

  const chainCheck = verifyReceiptChain(receipts);
  if (!chainCheck.valid) {
    console.error(`receipt chain failed at seq ${chainCheck.index}: ${chainCheck.error}`);
    process.exit(1);
  }
  console.log(`receipt chain valid (${chainCheck.count} receipts, head=${chainCheck.headHash})`);

  let failures = 0;
  for (const r of receipts) {
    if (!r.body.txHash) {
      console.log(`seq=${r.body.seq} ${r.body.finalAction} (${r.body.decisionCode}) [off-chain refusal/skip]`);
      continue;
    }
    const tx = (await getTransaction.handler({ network: "testnet", hash: r.body.txHash }, ctx)) as TxRes;
    const pq = (await getPqStatus.handler({ network: "testnet", target: r.body.txHash }, ctx)) as PqRes;
    const execFailures = tx.execution_failures?.length ?? 0;
    const expectedSuccess = r.body.txStatus === "confirmed";
    const actualSuccess = tx.success === true && execFailures === 0;
    const pqOk = pq.transaction_status?.tier === "pqc" && pq.transaction_status.verification.verified === true;
    const ok = actualSuccess === expectedSuccess && pqOk;
    if (!ok) failures += 1;
    console.log(
      `${ok ? "PASS" : "FAIL"} seq=${r.body.seq} tx=${r.body.txHash} status=${r.body.txStatus} chainSuccess=${actualSuccess} pqcVerified=${pqOk}`,
    );
  }
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
