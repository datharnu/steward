import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { TESTNET } from "haven-pq-kit";
import { encodeDeployData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { qorechainDiana } from "haven-pq-kit";
import { FUSD_ADDRESS, PAYGATE_ABI } from "../src/ts/paygate.js";
import { evmClient, loadAccount, withEvmWindow } from "./lib/chain.js";

/**
 * Deploy PayGate to qorechain-diana inside an unscoped EVM window (required for
 * contract creation), estimating gas against the live node because PayGate's
 * constructor checks `pqcKeyStatus(owner)`.
 */
async function main(): Promise<void> {
  const ownerName = process.env.STEWARD_OWNER ?? "spike";
  const delaySeconds = BigInt(process.env.STEWARD_TIMELOCK_SEC ?? "900"); // 15 minutes
  const dailyCap = BigInt(process.env.STEWARD_DAILY_CAP ?? "2500000000"); // 2,500 fUSD
  const agentDays = BigInt(process.env.STEWARD_AGENT_DAYS ?? "30");

  const artifactPath = "out/PayGate.sol/PayGate.json";
  if (!existsSync(artifactPath)) {
    throw new Error(`missing ${artifactPath}; run scripts/forge.sh build first`);
  }
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
    abi: unknown[];
    bytecode: { object: string };
  };

  const owner = await loadAccount(ownerName);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const agentUntil = now + agentDays * 86400n;
  // The linked agent key executes EVM calls FROM the owner's canonical EVM address.
  const agentEvm = owner.evm as Address;

  const deployData = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as Hex,
    args: [owner.evm as Address, FUSD_ADDRESS, delaySeconds, agentEvm, agentUntil, dailyCap],
  });

  const client = evmClient();
  const signer = privateKeyToAccount(owner.privateKey as Hex);

  const { result, openHash, closeHash } = await withEvmWindow(
    ownerName,
    { txs: 1, maxValueUqor: "3000000", blocks: 200 },
    async () => {
      const nonce = await client.getTransactionCount({ address: signer.address, blockTag: "pending" });
      const gasPrice = await client.getGasPrice();
      const gas = await client.estimateGas({ account: signer, data: deployData });
      // A creation sent through sendTransaction is rejected locally before the chain sees it.
      const signed = await signer.signTransaction({
        chainId: qorechainDiana.id,
        nonce,
        gas,
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: gasPrice,
        data: deployData,
        type: "eip1559",
      });
      const hash = await client.sendRawTransaction({ serializedTransaction: signed });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success" || !receipt.contractAddress) {
        throw new Error(`PayGate deploy failed: ${hash}`);
      }
      return { hash, contractAddress: receipt.contractAddress };
    },
  );

  // Sanity-check the deployed PayGate reads cleanly.
  const onChainOwner = await client.readContract({
    address: result.contractAddress,
    abi: PAYGATE_ABI,
    functionName: "owner",
  });

  const record = {
    network: TESTNET.chainId,
    evmChainId: TESTNET.evmChainId,
    payGate: result.contractAddress,
    token: FUSD_ADDRESS,
    ownerCosmos: owner.cosmos,
    ownerEvm: onChainOwner,
    agentEvm,
    timelockDelay: delaySeconds.toString(),
    dailyCap: dailyCap.toString(),
    agentUntil: agentUntil.toString(),
    transactions: [
      { hash: openHash, tier: "pqc", note: "open EVM window for PayGate deploy" },
      { hash: result.hash, tier: "classical", note: `deploy PayGate at ${result.contractAddress}` },
      { hash: closeHash, tier: "pqc", note: "close PayGate deploy window" },
    ],
  };

  mkdirSync("deployments", { recursive: true });
  writeFileSync("deployments/paygate.json", `${JSON.stringify(record, null, 2)}\n`);
  console.log(`PayGate deployed at ${result.contractAddress} (tx ${result.hash})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
