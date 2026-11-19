/**
 * Steward's first spike. Link a fresh key to the funded owner with one spending
 * rule: the only EVM call is PayStub.pay, and no denom is listed. Then, with
 * that key, try (a) fUSD.transfer, (b) a bank send, (c) PayStub.pay.
 * Stop reading a pass into anything the chain did not actually refuse.
 */
import { readFileSync, existsSync } from "node:fs";
import { StargateClient } from "@cosmjs/stargate";
import {
  EthNativeSigner,
  deriveUnifiedAccount,
  evmAuthSignBytesV2,
  cosmosAuthSignBytes,
  executeCosmosMsg,
  executeEvmMsg,
  fetchAuthNonce,
  fetchAuthenticators,
  fetchSpendingRules,
  generateMnemonic,
  linkAuthenticatorMsgs,
  signAuthenticatorLinkEip191,
  openEvmWindowMsg,
  closeEvmWindowMsg,
  resolveEvmAuthDigestVersion,
  type UnifiedAccount,
} from "@qorechain/sdk";
import {
  createPublicClient,
  encodeFunctionData,
  getContractAddress,
  hexToBytes,
  http,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";
import { readMnemonic, writeSecret } from "./secrets.js";

const CHAIN_ID = "qorechain-diana";
const REST = "https://api-testnet.qore.host";
const RPC = "https://rpc-testnet.qore.host";
const EVM_RPC = "https://evm-testnet.qore.host";
const FUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const BANK_TO = "qor10hr66l9zfsgkhp7jfpkpsav44nrdx6n8wdzett";
const FEE = { amount: [{ denom: "uqor", amount: "120000" }], gas: "800000" };

const chain = defineChain({
  id: 9800,
  name: "QoreChain Diana",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [EVM_RPC] } },
});

type TxView = {
  hash: string;
  code: number;
  rawLog: string;
  failed: { type: string; reason: string; success: string }[];
};

async function ownerAccount(): Promise<UnifiedAccount> {
  return deriveUnifiedAccount(readMnemonic("spike"));
}

async function agentAccount(): Promise<UnifiedAccount> {
  if (!existsSync(`${process.env.HOME}/.haven/steward-agent.env`)) {
    writeSecret("steward-agent", generateMnemonic(256));
  }
  return deriveUnifiedAccount(readMnemonic("steward-agent"));
}

async function accountSequence(account: UnifiedAccount): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const evm = createPublicClient({ chain, transport: http(EVM_RPC) });
  const [response, nonce] = await Promise.all([
    fetch(`${REST}/cosmos/auth/v1beta1/accounts/${account.cosmos}`),
    evm.getTransactionCount({ address: account.evm as Address, blockTag: "pending" }),
  ]);
  if (!response.ok) throw new Error(`account ${account.cosmos} is not on chain (${response.status})`);
  const body = (await response.json()) as { account?: { account_number?: string } };
  if (!body.account?.account_number) throw new Error(`account ${account.cosmos} is not on chain`);
  return { accountNumber: BigInt(body.account.account_number), sequence: BigInt(nonce) };
}

async function broadcast(account: UnifiedAccount, messages: Parameters<EthNativeSigner["sign"]>[0]["messages"]): Promise<TxView> {
  const auth = await accountSequence(account);
  const signer = new EthNativeSigner(account, { signMode: "hybrid", rest: REST, signBytesVersion: "auto" });
  const node = await StargateClient.connect(RPC);
  try {
    const result = await signer.signAndBroadcast(node, {
      chainId: CHAIN_ID,
      messages,
      fee: FEE,
      accountNumber: auth.accountNumber,
      sequence: auth.sequence,
    });
    const body = (await fetch(`${REST}/cosmos/tx/v1beta1/txs/${result.transactionHash}`).then((r) => r.json())) as {
      tx_response?: { raw_log?: string; events?: { type: string; attributes?: { key: string; value: string }[] }[] };
    };
    const events = body.tx_response?.events ?? [];
    const failed = events
      .filter((event) => event.type === "abstractaccount_execution_failed" || event.type === "abstractaccount_execution")
      .map((event) => {
        const attrs = Object.fromEntries((event.attributes ?? []).map((a) => [a.key, a.value]));
        return { type: event.type, reason: attrs.reason ?? "", success: attrs.success ?? "" };
      });
    return {
      hash: result.transactionHash,
      code: result.code,
      rawLog: (body.tx_response?.raw_log ?? result.rawLog ?? "").slice(0, 900),
      failed,
    };
  } finally {
    node.disconnect();
  }
}

async function deployStub(account: UnifiedAccount): Promise<Address> {
  const artifact = JSON.parse(readFileSync(new URL("../out/PayStub.sol/PayStub.json", import.meta.url), "utf8")) as {
    bytecode: { object: string };
  };
  const bytecode = artifact.bytecode.object as Hex;
  const open = await broadcast(account, [
    openEvmWindowMsg({ sender: account.cosmos, blocks: 200, maxTxs: 1, maxValue: "2000000" }),
  ]);
  console.log(`window ${open.code} ${open.hash}`);
  if (open.code !== 0) throw new Error(`window refused: ${open.rawLog}`);
  try {
    const client = createPublicClient({ chain, transport: http(EVM_RPC) });
    const signer = privateKeyToAccount(account.privateKey as Hex);
    const nonce = await client.getTransactionCount({ address: signer.address, blockTag: "pending" });
    const gasPrice = await client.getGasPrice();
    const predicted = getContractAddress({ from: signer.address, nonce: BigInt(nonce) });
    const signed = await signer.signTransaction({
      chainId: chain.id,
      nonce,
      gas: 500_000n,
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice,
      data: bytecode,
      type: "eip1559",
    });
    const hash = await client.sendRawTransaction({ serializedTransaction: signed });
    const receipt = await client.waitForTransactionReceipt({ hash });
    console.log(`deploy status=${receipt.status} ${hash} contract=${receipt.contractAddress} predicted=${predicted}`);
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`deploy failed ${hash}`);
    return receipt.contractAddress;
  } finally {
    const closed = await broadcast(account, [closeEvmWindowMsg(account.cosmos)]);
    console.log(`window-closed ${closed.code} ${closed.hash}`);
  }
}

async function signEvm(agent: UnifiedAccount, input: {
  to: string;
  data: Uint8Array;
  gasLimit: bigint;
  nonce: bigint;
}): Promise<Uint8Array> {
  const pubkey = hexToBytes(agent.evm as Hex);
  const digest = evmAuthSignBytesV2({
    chainId: CHAIN_ID,
    account: (await ownerAccount()).cosmos,
    pubkey,
    to: input.to,
    value: "0",
    data: input.data,
    nonce: input.nonce,
    gasLimit: input.gasLimit,
  });
  const signature = await privateKeyToAccount(agent.privateKey as Hex).signMessage({ message: { raw: digest } });
  return hexToBytes(signature);
}

async function main(): Promise<void> {
  const owner = await ownerAccount();
  const agent = await agentAccount();
  console.log(`owner ${owner.cosmos} ${owner.evm}`);
  console.log(`agent ${agent.evm}`);

  const absent = async <T>(fallback: T, read: () => Promise<T>): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not found")) return fallback;
      throw error;
    }
  };
  const [rules, keys, config] = await Promise.all([
    absent({ rules: [], authenticatorRules: [] }, () => fetchSpendingRules({ rest: REST, address: owner.cosmos })),
    absent([], () => fetchAuthenticators({ rest: REST, address: owner.cosmos })),
    fetch(`${REST}/qorechain/abstractaccount/v1/config`).then((r) => r.json()) as Promise<{
      config?: { default_session_ttl?: string; enabled?: boolean };
    }>,
  ]);
  if (!config.config?.enabled) throw new Error(`abstract accounts are not enabled: ${JSON.stringify(config)}`);
  const ttl = BigInt(config.config.default_session_ttl ?? "0");
  if (ttl < 120n) throw new Error(`session ttl ${ttl} is too short to use`);
  const selector = toFunctionSelector("function pay()");
  const proof = signAuthenticatorLinkEip191({
    chainId: CHAIN_ID,
    account: owner.cosmos,
    privateKey: agent.privateKey,
  });

  let stub: Address;
  const existing = rules.rules[0];
  const agentHex = agent.evm.slice(2).toLowerCase();
  const agentLinked = keys.some((key) => !key.revoked && key.pubkeyHex.toLowerCase() === agentHex);
  if (existing) {
    const call = existing.allowedEvmCalls[0] ?? "";
    if (rules.rules.length !== 1 || existing.id !== "agent" || !call.endsWith(`/${selector}`)) {
      throw new Error("the owner has a spending rule this spike did not write; refusing to replace it");
    }
    if (!agentLinked) throw new Error("the rule is on chain but the agent key is not linked");
    stub = call.split("/")[0] as Address;
    console.log(`resuming with ${call}`);
  } else {
    stub = await deployStub(owner);
    const allowedCall = `${stub.toLowerCase()}/${selector}`;
    console.log(`allowed call ${allowedCall}`);
    const expiry = BigInt(Math.floor(Date.now() / 1000)) + ttl - 60n;
    const link = await broadcast(
      owner,
      linkAuthenticatorMsgs({
        owner: owner.cosmos,
        account: owner.cosmos,
        chainId: CHAIN_ID,
        scheme: "secp256k1",
        pubkey: proof.pubkey,
        permissions: ["evm"],
        expiryUnix: expiry,
        label: "steward-agent",
        possessionProof: proof.possessionProof,
        spendingRule: {
          id: "agent",
          enabled: true,
          perTxLimit: "1",
          dailyLimit: "1",
          allowedDenoms: [],
          allowedEvmCalls: [allowedCall],
        },
      }),
    );
    console.log(`link code=${link.code} ${link.hash}`);
    console.log(link.rawLog);
    if (link.code !== 0) throw new Error("link failed");
  }

  const version = await resolveEvmAuthDigestVersion({ rest: REST });
  if (version !== "v2") throw new Error(`expected evm auth digest v2, node says ${version}`);
  const relayer = owner.cosmos;
  const pubkey = proof.pubkey;

  const transfer = hexToBytes(
    encodeFunctionData({
      abi: [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }],
      functionName: "transfer",
      args: [owner.evm as Address, 1n],
    }),
  );
  const pay = hexToBytes(selector);

  async function evmAttempt(name: string, to: string, data: Uint8Array): Promise<void> {
    const gasLimit = 200_000n;
    const nonce = (await fetchAuthNonce({ rest: REST, address: owner.cosmos, pubkey })).nonce;
    const signature = await signEvm(agent, { to, data, gasLimit, nonce });
    const message = executeEvmMsg({ relayer, account: owner.cosmos, scheme: "secp256k1", pubkey, signature, to, value: "0", data, gasLimit, nonce });
    try {
      const tx = await broadcast(owner, [message]);
      console.log(`ATTEMPT ${name} code=${tx.code} hash=${tx.hash}`);
      console.log(tx.rawLog);
      console.log(`events ${JSON.stringify(tx.failed)}`);
    } catch (error) {
      console.log(`ATTEMPT ${name} REJECTED ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await evmAttempt("a-fusd-transfer", FUSD.toLowerCase(), transfer);

  const cosmosNonce = (await fetchAuthNonce({ rest: REST, address: owner.cosmos, pubkey })).nonce;
  const amount = "1uqor";
  const cosmosDigest = cosmosAuthSignBytes({ chainId: CHAIN_ID, account: owner.cosmos, pubkey, to: BANK_TO, amount, nonce: cosmosNonce });
  const cosmosSig = hexToBytes(await privateKeyToAccount(agent.privateKey as Hex).signMessage({ message: { raw: cosmosDigest } }));
  try {
    const bank = await broadcast(owner, [
      executeCosmosMsg({ relayer, account: owner.cosmos, scheme: "secp256k1", pubkey, signature: cosmosSig, to: BANK_TO, amount, nonce: cosmosNonce }),
    ]);
    console.log(`ATTEMPT b-bank-send code=${bank.code} hash=${bank.hash}`);
    console.log(bank.rawLog);
    console.log(`events ${JSON.stringify(bank.failed)}`);
  } catch (error) {
    console.log(`ATTEMPT b-bank-send REJECTED ${error instanceof Error ? error.message : String(error)}`);
  }

  await evmAttempt("c-pay", stub.toLowerCase(), pay);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
