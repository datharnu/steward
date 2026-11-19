/**
 * Buy a little fUSD from the testnet pool, then convert that bank coin straight
 * into PayGate. The owner was funded in QOR, not by the faucet, so it holds no
 * fest token until this swap. MsgConvertCoin is not in the SDK; the type URL and
 * fields are the ones the chain accepted on a public transaction.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { BinaryWriter } from "cosmjs-types/binary";
import { msg, qorechainRegistry, type EncodeObject } from "@qorechain/sdk";
import { TESTNET } from "haven-pq-kit";
import { type Address } from "viem";
import { FUSD_ADDRESS } from "../src/ts/paygate.js";
import { broadcast, loadAccount } from "./lib/chain.js";

const FUSD_DENOM = `erc20:${FUSD_ADDRESS}`;
const CONVERT = "/cosmos.evm.erc20.v1.MsgConvertCoin";

const ConvertCoin = {
  typeUrl: CONVERT,
  fromPartial(value: { coin?: { denom?: string; amount?: string }; receiver?: string; sender?: string }) {
    return {
      coin: { denom: value.coin?.denom ?? "", amount: value.coin?.amount ?? "0" },
      receiver: value.receiver ?? "",
      sender: value.sender ?? "",
    };
  },
  encode(
    message: { coin: { denom: string; amount: string }; receiver: string; sender: string },
    writer = new BinaryWriter(),
  ) {
    const coin = new BinaryWriter();
    coin.uint32(10).string(message.coin.denom);
    coin.uint32(18).string(message.coin.amount);
    writer.uint32(10).bytes(coin.finish());
    writer.uint32(18).string(message.receiver);
    writer.uint32(26).string(message.sender);
    return writer;
  },
  decode() {
    throw new Error("decode is unused");
  },
};

function convertMsg(sender: string, receiver: string, amount: string): EncodeObject {
  return { typeUrl: CONVERT, value: { coin: { denom: FUSD_DENOM, amount }, receiver, sender } };
}

function quote(reserveIn: bigint, reserveOut: bigint, amountIn: bigint, feeBps: bigint): bigint {
  const net = (amountIn * (10_000n - feeBps)) / 10_000n;
  return (reserveOut * net) / (reserveIn + net);
}

async function main(): Promise<void> {
  const ownerName = process.env.STEWARD_OWNER ?? "spike";
  const deployment = JSON.parse(readFileSync("deployments/paygate.json", "utf8")) as {
    payGate: Address;
    transactions: { hash: string; tier: string; note: string }[];
  };
  const owner = await loadAccount(ownerName);
  const [poolsBody, paramsBody, balancesBody] = await Promise.all([
    fetch(`${TESTNET.rest}/qorechain/amm/v1/pools`).then((r) => r.json()) as Promise<{
      pools: { id: string; token_a: string; token_b: string; reserve_a: string; reserve_b: string; status: string }[];
    }>,
    fetch(`${TESTNET.rest}/qorechain/amm/v1/params`).then((r) => r.json()) as Promise<{
      params?: { swap_fee_bps?: string | number };
    }>,
    fetch(`${TESTNET.rest}/cosmos/bank/v1beta1/balances/${owner.cosmos}`).then((r) => r.json()) as Promise<{
      balances: { denom: string; amount: string }[];
    }>,
  ]);
  const pool = poolsBody.pools.find((item) => item.id === "2" && item.status === "active");
  if (!pool || pool.token_a !== FUSD_DENOM || pool.token_b !== "uqor") {
    throw new Error(`pool 2 is not uqor/fUSD: ${JSON.stringify(pool)}`);
  }
  const feeBps = BigInt(paramsBody.params?.swap_fee_bps ?? "0");
  const uqor = BigInt(balancesBody.balances.find((coin) => coin.denom === "uqor")?.amount ?? "0");
  const spend = uqor > 2_500_000n ? 500_000n : uqor / 5n;
  if (spend < 10_000n) throw new Error(`not enough uqor to buy fUSD (${uqor})`);
  const expected = quote(BigInt(pool.reserve_b), BigInt(pool.reserve_a), spend, feeBps);
  const minOut = (expected * 90n) / 100n;
  if (minOut < 1n) throw new Error("the quote is dust");

  const swap = await broadcast(owner, [
    msg.amm.swapExactIn({
      sender: owner.cosmos,
      poolId: "2",
      tokenIn: { denom: "uqor", amount: spend.toString() },
      denomOut: FUSD_DENOM,
      minOut: minOut.toString(),
    }),
  ]);
  console.log(`swapped ${spend} uqor, at least ${minOut} fUSD base units: ${swap}`);

  const after = (await fetch(`${TESTNET.rest}/cosmos/bank/v1beta1/balances/${owner.cosmos}/by_denom?denom=${encodeURIComponent(FUSD_DENOM)}`).then(
    (r) => r.json(),
  )) as { balance?: { amount?: string } };
  const bought = after.balance?.amount ?? "0";
  if (BigInt(bought) < 1n) throw new Error("the swap left no fUSD to convert");

  const converted = await broadcast(
    owner,
    [convertMsg(owner.cosmos, deployment.payGate, bought)],
    "hybrid",
    qorechainRegistry([[CONVERT, ConvertCoin]]),
  );
  console.log(`converted ${bought} fUSD base units into ${deployment.payGate}: ${converted}`);

  deployment.transactions.push(
    { hash: swap, tier: "pqc", note: `swap ${spend} uqor for fUSD on pool 2` },
    { hash: converted, tier: "pqc", note: `MsgConvertCoin of ${bought} fUSD base units into PayGate` },
  );
  writeFileSync("deployments/paygate.json", `${JSON.stringify(deployment, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
