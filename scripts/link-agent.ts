import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  fetchAuthenticators,
  linkAuthenticatorMsgs,
  revokeAuthenticatorMsg,
  signAuthenticatorLinkEip191,
} from "@qorechain/sdk";
import { TESTNET } from "haven-pq-kit";
import { bytesToHex, type Address } from "viem";
import { PAY_SELECTOR, QUEUE_SELECTOR } from "../agent/relayer.js";
import { broadcast, loadAccount } from "./lib/chain.js";

/**
 * Link the Steward agent key (`~/.haven/steward-agent.env`) to the owner's
 * smart account with a spending rule whose ONLY allowed EVM calls are
 * `PayGate.pay` and `PayGate.queue` (no `allowedDenoms`, bounded expiry).
 *
 * The chain's session is 24 hours. Running this again revokes the live
 * authenticator and registers a new one, which is what moves the expiry.
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
  const linked = await fetchAuthenticators({ rest: TESTNET.rest, address: owner.cosmos });
  const agentPubkey = bytesToHex(proof.pubkey).slice(2).toLowerCase();
  const live = linked.find(
    (key) => !key.revoked && key.pubkeyHex.replace(/^0x/, "").toLowerCase() === agentPubkey,
  );
  // linkAuthenticatorMsgs replaces the account's rules, then registers the key.
  // A key that is already linked, including an expired one, is revoked first in
  // the same transaction. The chain applies the messages in order.
  const register = linkAuthenticatorMsgs({
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
  const msgs = live
    ? [
        revokeAuthenticatorMsg({
          owner: owner.cosmos,
          account: owner.cosmos,
          scheme: "secp256k1",
          pubkey: proof.pubkey,
        }),
        ...register,
      ]
    : register;

  const hash = await broadcast(owner, msgs, "hybrid");
  const until = new Date(Number(expiryUnix) * 1000).toISOString();
  console.log(
    `${live ? "renewed" : "linked"} ${agent.evm} -> ${owner.cosmos} until ${until} (unix ${expiryUnix}) for ${allowedCalls.join(", ")} (tx ${hash})`,
  );

  deployment.transactions.push({
    hash,
    tier: "pqc",
    note: `${live ? "renew" : "link"} agent ${agent.evm} until unix ${expiryUnix}`,
  });
  writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
