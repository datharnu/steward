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
 * Running this again revokes the live authenticator and registers a new one, which is
 * what moves the expiry.
 *
 * Session length. By default the expiry is now + the chain's `default_session_ttl`
 * (86,400 s on qorechain-diana, read from /qorechain/abstractaccount/v1/config) minus 60 s.
 * Override it with `--ttl <seconds>` / `STEWARD_SESSION_TTL`, or `--until <ISO date>` /
 * `STEWARD_SESSION_UNTIL`. `MsgRegisterAuthenticator` documents that the expiry "must be within
 * MaxSessionTTL", and the module's REST config does not publish that maximum, so a longer
 * session is untested: if the chain refuses it, the whole transaction fails (the revoke and
 * the new rule with it) and only the fee is spent. `--dry-run` prints the plan and sends nothing.
 */
export function sessionExpiry(opts: {
  nowUnix: bigint;
  chainTtl: bigint;
  ttl?: string;
  until?: string;
}): { expiryUnix: bigint; requestedTtl: bigint; overChainDefault: boolean } {
  if (opts.ttl && opts.until) throw new Error("give --ttl or --until, not both");
  let expiryUnix: bigint;
  if (opts.until) {
    const ms = Date.parse(opts.until);
    if (Number.isNaN(ms)) throw new Error(`--until is not a date: ${opts.until}`);
    expiryUnix = BigInt(Math.floor(ms / 1000));
  } else if (opts.ttl) {
    if (!/^[1-9][0-9]*$/.test(opts.ttl)) throw new Error(`--ttl must be a positive number of seconds, got ${opts.ttl}`);
    expiryUnix = opts.nowUnix + BigInt(opts.ttl);
  } else {
    expiryUnix = opts.nowUnix + opts.chainTtl - 60n;
  }
  const requestedTtl = expiryUnix - opts.nowUnix;
  if (requestedTtl < 120n) throw new Error(`session would last ${requestedTtl}s; that is too short to use`);
  return { expiryUnix, requestedTtl, overChainDefault: requestedTtl > opts.chainTtl };
}

function flag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
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

  const cfgRes = (await fetch(`${TESTNET.rest}/qorechain/abstractaccount/v1/config`).then((r) => r.json())) as {
    config?: { default_session_ttl?: string; enabled?: boolean };
  };
  if (!cfgRes.config?.enabled) throw new Error("abstractaccount module is disabled");
  const chainTtl = BigInt(cfgRes.config.default_session_ttl ?? "86400");
  const { expiryUnix, requestedTtl, overChainDefault } = sessionExpiry({
    nowUnix: BigInt(Math.floor(Date.now() / 1000)),
    chainTtl,
    ttl: flag(argv, "--ttl") ?? process.env.STEWARD_SESSION_TTL,
    until: flag(argv, "--until") ?? process.env.STEWARD_SESSION_UNTIL,
  });

  const gateLower = deployment.payGate.toLowerCase();
  const allowedCalls = [`${gateLower}/${PAY_SELECTOR}`, `${gateLower}/${QUEUE_SELECTOR}`];
  const untilIso = new Date(Number(expiryUnix) * 1000).toISOString();
  console.log(`session ${requestedTtl}s, until ${untilIso} (unix ${expiryUnix}); chain default_session_ttl ${chainTtl}s`);
  if (overChainDefault) {
    console.log(
      "warning: longer than the chain's default_session_ttl. The chain's maximum (MaxSessionTTL) is not published; if it is lower, this transaction fails as a whole and only the fee is spent.",
    );
  }
  if (dryRun) {
    console.log(`dry run: would link ${agentName} under rule steward-agent for ${allowedCalls.join(", ")}; nothing sent`);
    return;
  }

  const owner = await loadAccount(ownerName);
  const agent = await loadAccount(agentName);

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
  console.log(
    `${live ? "renewed" : "linked"} ${agent.evm} -> ${owner.cosmos} until ${untilIso} (unix ${expiryUnix}) for ${allowedCalls.join(", ")} (tx ${hash})`,
  );

  deployment.transactions.push({
    hash,
    tier: "pqc",
    note: `${live ? "renew" : "link"} agent ${agent.evm} until unix ${expiryUnix}`,
  });
  writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`);
}

if (process.argv[1]?.endsWith("link-agent.ts")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
