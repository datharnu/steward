/**
 * Move testnet QOR between two of your own ~/.haven accounts (fees for spike, the relayer).
 *
 *   npm run send-qor -- <fromName> <toName> <qor>      e.g. npm run send-qor -- ledger-payer spike 15
 */
import { msg } from "@qorechain/sdk";
import { broadcast, loadAccount } from "./lib/chain.js";

async function main(): Promise<void> {
  const [fromName, toName, qorStr] = process.argv.slice(2);
  if (!fromName || !toName || !qorStr) throw new Error("usage: npm run send-qor -- <fromName> <toName> <qor>");
  const qor = Number(qorStr);
  if (!Number.isFinite(qor) || qor <= 0 || qor > 50) throw new Error("amount must be > 0 and <= 50 QOR");
  const uqor = BigInt(Math.round(qor * 1e6)).toString();
  const from = await loadAccount(fromName);
  const to = await loadAccount(toName);
  const hash = await broadcast(from, [
    msg.bank.send({ fromAddress: from.cosmos, toAddress: to.cosmos, amount: [{ denom: "uqor", amount: uqor }] }),
  ]);
  console.log(`sent ${qor} QOR ${fromName} (${from.cosmos}) -> ${toName} (${to.cosmos}): ${hash}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
