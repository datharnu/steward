import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TOOLS, toolContext } from "@qorechain/mcp";

/**
 * Re-checks every recorded testnet hash in `deployments/*.json` through `@qorechain/mcp`:
 * - `pqc`: hybrid-signed transaction, succeeded, and ML-DSA-87 layer verified.
 * - `enrollment`: classically signed ML-DSA registration.
 * - `classical`: EVM-lane transaction inside a scoped window.
 * - `refused`: expected on-chain refusal (code != 0 or `execution_failures` present).
 * `noHashRefusals` (deployments/agent-window.json) are refusals the node made at broadcast: they
 * have no hash, so they are printed with the recorded error text and are not counted or re-checked.
 */
type Tier = "pqc" | "enrollment" | "classical" | "refused";

type Entry = { hash: string; tier: Tier; note: string };
type NoHashRefusal = {
  step: string;
  limit: string;
  signedHash: string;
  chainError: { code: number | null; message: string };
  height: string;
};
type DeploymentFile = { network: string; transactions: Entry[]; noHashRefusals?: NoHashRefusal[] };
type Unrecheckable = { file: string; refusal: NoHashRefusal };
type Row = { file: string; hash: string; tier: Tier; ok: boolean; detail: string; note: string };

type TransactionResult = { success: boolean; failure?: unknown; execution_failures?: unknown[] };
type PqStatusResult = {
  transaction_status: {
    tier: string;
    has_exactly_one_pqc_layer: boolean;
    verification: { checked: boolean; verified: boolean | null; reason: string | null };
  } | null;
};

function tool(name: string) {
  const found = TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`@qorechain/mcp has no ${name} tool`);
  return found;
}

const getTransaction = tool("get_transaction");
const getPqStatus = tool("get_pq_status");
const ctx = toolContext({ defaultNetwork: "testnet" });

async function check(file: string, entry: Entry): Promise<Row> {
  const row = { file, hash: entry.hash, tier: entry.tier, ok: false, detail: "", note: entry.note };
  try {
    const tx = (await getTransaction.handler({ network: "testnet", hash: entry.hash }, ctx)) as TransactionResult;
    const refused = (tx.execution_failures?.length ?? 0) > 0;
    if (entry.tier === "refused") {
      const ok = tx.success === false || refused;
      return { ...row, ok, detail: `success=${String(tx.success)} execFailures=${tx.execution_failures?.length ?? 0}` };
    }
    const pq = (await getPqStatus.handler({ network: "testnet", target: entry.hash }, ctx)) as PqStatusResult;
    const status = pq.transaction_status;
    const parts = [`success=${String(tx.success)}`, `tier=${status?.tier ?? "?"}`];
    let ok = tx.success === true && !refused && status?.tier === entry.tier;
    if (entry.tier === "pqc") {
      const verified = status?.has_exactly_one_pqc_layer === true && status.verification.verified === true;
      parts.push(`ml-dsa=${String(verified)}`);
      ok = ok && verified;
    }
    return { ...row, ok, detail: parts.join(" ") };
  } catch (error) {
    return { ...row, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Re-checks every hash. Refusals the node made at broadcast (no hash, e.g. an EVM window limit in
 * deployments/agent-window.json) are returned separately: there is nothing on chain to re-check,
 * only the node's recorded error text.
 */
export async function checkEvidence(dir: string): Promise<{ rows: Row[]; unrecheckable: Unrecheckable[] }> {
  if (!existsSync(dir)) return { rows: [], unrecheckable: [] };
  const files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  const rows: Row[] = [];
  const unrecheckable: Unrecheckable[] = [];
  for (const name of files) {
    const document = JSON.parse(readFileSync(join(dir, name), "utf8")) as DeploymentFile;
    if (document.network !== "qorechain-diana") throw new Error(`${name}: network ${document.network} is not the testnet`);
    for (const entry of document.transactions ?? []) rows.push(await check(name, entry));
    for (const refusal of document.noHashRefusals ?? []) unrecheckable.push({ file: name, refusal });
  }
  return { rows, unrecheckable };
}

function printUnrecheckable(items: Unrecheckable[]): void {
  if (items.length === 0) return;
  console.log(`\nRefused at broadcast, no transaction hash (${items.length}): not re-checkable on chain; the node's answer as recorded:`);
  for (const { file, refusal } of items) {
    console.log(
      `  ${file}  ${refusal.step} (${refusal.limit} limit) at height ${refusal.height}: [${refusal.chainError.code ?? "-"}] ${refusal.chainError.message}  (signed hash ${refusal.signedHash}, never included)`,
    );
  }
}

function printTable(rows: Row[]): void {
  const header = ["result", "file", "tier", "hash", "detail", "note"];
  const lines = rows.map((row) => [row.ok ? "PASS" : "FAIL", row.file, row.tier, row.hash, row.detail, row.note]);
  const widths = header.map((_, i) => Math.max(header[i].length, ...lines.map((line) => line[i].length)));
  const format = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i])).join("  ");
  console.log(format(header));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const line of lines) console.log(format(line));
}

const dir = process.argv[2] ?? "deployments";
checkEvidence(dir)
  .then(({ rows, unrecheckable }) => {
    if (rows.length === 0) {
      console.error(`no transactions recorded in ${dir}`);
      process.exit(1);
    }
    printTable(rows);
    printUnrecheckable(unrecheckable);
    const failed = rows.filter((row) => !row.ok).length;
    console.log(`\n${rows.length - failed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
