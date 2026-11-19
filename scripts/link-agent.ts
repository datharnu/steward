import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  fetchAuthenticators,
  linkAuthenticatorMsgs,
  msg,
  signAuthenticatorLinkEip191,
} from "@qorechain/sdk";
import { TESTNET } from "haven-pq-kit";
import { toFunctionSelector, type Address, type Hex } from "viem";
import { PAY_SELECTOR, QUEUE_SELECTOR } from "../agent/relayer.js";
import { broadcast, loadAccount } from "./lib/chain.js";

/**
 * Link the Steward agent key (`~/.haven/steward-agent.env`) to the owner's
 * smart account with a spending rule whose ONLY allowed EVM calls are
 * `PayGate.pay` and `PayGate.queue` (no `allowedDenoms`, bounded expiry).
 */
async function main(): Promise<void> {
  const ownerName = process.env.STEWARD_OWNER ?? "spike";
  const agentName = process.env.STEWARD_AGENT ?? "steward-agent";
  const deploymentPath = "deployments/paygate.json";
  if (!existsSync(deploymentPath)) {
    throw new Error(`missing ${deploymentPath}; run npm run deploy first`);
  }
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf8")) as {
    payGate: Address;
    transactions: { hash: string; tier: string; note: string }[];
  };

  const owner = await loadAccount(ownerName);
  const agent = await loadAccount(agentName);

  const cfgRes = (await fetch(`${TESTNET.rest}/qorechain/abstractaccount/v1/config`).then((r) => r.json())) as {
    config?: { default_session_ttl?: string; enabled?: boolean };
  };
  if (!cfgRes.config?.enabled) throw new Error("abstractaccount module is disabled");
  const ttl = BigInt(cfgRes.config.default_session_ttl ?? "86400");
  const expiryUnix = BigInt(Math.floor(Date.now() / 1000)) + ttl - 60n;

  const gateLower = deployment.payGate.toLowerCase();
  const allowedCalls = [`${gateLower}/${PAY_SELECTOR}`, `${gateLower}/${QUEUE_SELECTOR}`];

  const proof = signAuthenticatorLinkEip191({
    chainId: TESTNET.chainId,
    account: owner.cosmos,
    privateKey: agent.privateKey,
  });
  const rule = {
    id: "steward-agent",
    enabled: true,
    perTxLimit: "1",
    dailyLimit: "1",
    allowedDenoms: [],
    allowedEvmCalls: allowedCalls,
    denomLimits: [],
  };
  const linked = await fetchAuthenticators({ rest: TESTNET.rest, address: owner.cosmos }).catch(() => []);
  const already = linked.some((key) => !key.revoked && key.pubkeyHex.toLowerCase() === agent.evm.slice(2).toLowerCase());
  // Updating replaces the account's rules. The key from the spike is already linked, so it is not registered again.
  const msgs = already
    ? [
        msg.abstractaccount.updateSpendingRules({
          owner: owner.cosmos,
          accountAddress: owner.cosmos,
          rules: [rule],
        }),
      ]
    : linkAuthenticatorMsgs({
        owner: owner.cosmos,
        account: owner.cosmos,
        chainId: TESTNET.chainId,
        scheme: "secp256k1",
        pubkey: proof.pubkey,
        permissions: ["evm"],
        expiryUnix,
        label: "steward-paygate-agent",
        possessionProof: proof.possessionProof,
        spendingRule: rule,
      });

  const hash = await broadcast(owner, msgs, "hybrid");
  console.log(`linked ${agent.evm} -> ${owner.cosmos} for ${allowedCalls.join(", ")} (tx ${hash})`);

  deployment.transactions.push({
    hash,
    tier: "pqc",
    note: `link agent ${agent.evm} with spending rule for PayGate.pay and PayGate.queue`,
  });
  writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
