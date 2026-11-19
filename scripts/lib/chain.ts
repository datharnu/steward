import { StargateClient, type Registry } from "@cosmjs/stargate";
import { deriveSealKeys, type SealKeyPair } from "@qorechain/qoreseal";
import {
  EthNativeSigner,
  REGISTER_KEM_KEY_TYPE_URL,
  buildRegisterPqcKeyMsg,
  closeEvmWindowMsg,
  deriveUnifiedAccount,
  fetchEvmWindow,
  fetchPqcStatus,
  generateMnemonic,
  openEvmWindowMsg,
  signProofOfPossession,
  validateKemPublicKey,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { ALGORITHM_ML_KEM_1024, validateMlkemPublicKey } from "@qorechain/qoreseal";
import { fetchKemKey } from "@qorechain/qoreseal/network";
import { TESTNET, qorechainDiana } from "haven-pq-kit";
import {
  createPublicClient,
  createWalletClient,
  hexToBytes,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readMnemonic, writeSecret } from "../secrets.js";

export const CHAIN_ID = TESTNET.chainId;
const FEE = { amount: [{ denom: "uqor", amount: "180000" }], gas: "1200000" };

export function evmClient(): PublicClient {
  return createPublicClient({ chain: qorechainDiana, transport: http(TESTNET.evmRpc) });
}

export async function loadAccount(name: string): Promise<UnifiedAccount> {
  return deriveUnifiedAccount(readMnemonic(name));
}

export function loadSealKeys(name: string, index = 0): SealKeyPair {
  return deriveSealKeys({ mnemonic: readMnemonic(name), index });
}

export async function ensureAccount(name: string): Promise<UnifiedAccount> {
  try {
    return await loadAccount(name);
  } catch {
    const mnemonic = generateMnemonic(256);
    writeSecret(name, mnemonic);
    const acc = await deriveUnifiedAccount(mnemonic);
    console.log(`created ~/.haven/${name}.env -> ${acc.cosmos} (${acc.evm})`);
    return acc;
  }
}

export async function accountSequence(account: UnifiedAccount): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const client = evmClient();
  const [res, nonce] = await Promise.all([
    fetch(`${TESTNET.rest}/cosmos/auth/v1beta1/accounts/${account.cosmos}`),
    client.getTransactionCount({ address: account.evm as Address, blockTag: "pending" }),
  ]);
  if (!res.ok) throw new Error(`account ${account.cosmos} is not on chain (${res.status})`);
  const body = (await res.json()) as { account?: { account_number?: string } };
  if (!body.account?.account_number) throw new Error(`account ${account.cosmos} has no account_number on chain`);
  return { accountNumber: BigInt(body.account.account_number), sequence: BigInt(nonce) };
}

export type NativeMessages = Parameters<EthNativeSigner["sign"]>[0]["messages"];

export async function broadcast(
  account: UnifiedAccount,
  messages: NativeMessages,
  signMode: "hybrid" | "classical" = "hybrid",
  registry?: Registry,
): Promise<string> {
  const auth = await accountSequence(account);
  const signer = new EthNativeSigner(account, { signMode, rest: TESTNET.rest, signBytesVersion: "auto", registry });
  const node = await StargateClient.connect(TESTNET.rpc);
  try {
    const result = await signer.signAndBroadcast(node, {
      chainId: CHAIN_ID,
      messages,
      fee: FEE,
      accountNumber: auth.accountNumber,
      sequence: auth.sequence,
    });
    if (result.code !== 0) {
      throw new Error(`tx ${result.transactionHash} failed with code ${result.code}: ${result.rawLog ?? ""}`);
    }
    return result.transactionHash;
  } finally {
    node.disconnect();
  }
}

export async function registerMlDsa(name: string): Promise<string | undefined> {
  const account = await loadAccount(name);
  const status = await fetchPqcStatus({ rest: TESTNET.rest, address: account.cosmos });
  if (status.registered) {
    console.log(`ml-dsa already registered: ${account.cosmos}`);
    return undefined;
  }
  const proof = signProofOfPossession({
    chainId: CHAIN_ID,
    account: account.cosmos,
    algorithmId: 1,
    keypair: account.pqc,
  });
  const hash = await broadcast(
    account,
    [
      buildRegisterPqcKeyMsg(account.cosmos, {
        pqcKeypair: account.pqc,
        ecdsaPubkey: hexToBytes(account.publicKey as Hex),
        proofOfPossession: proof,
        keyType: "hybrid",
      }),
    ],
    "classical",
  );
  console.log(`ml-dsa registered ${account.cosmos}: ${hash}`);
  return hash;
}

export async function registerKem(name: string): Promise<string | undefined> {
  const account = await loadAccount(name);
  const keys = loadSealKeys(name);
  validateMlkemPublicKey(keys.mlkemPublicKey);
  validateKemPublicKey(keys.mlkemPublicKey, ALGORITHM_ML_KEM_1024);
  const current = await fetchKemKey({ rest: TESTNET.rest, address: account.cosmos });
  if (current.registered && current.publicKey?.every((b, i) => b === keys.mlkemPublicKey[i])) {
    console.log(`ml-kem already published: ${account.cosmos}`);
    return undefined;
  }
  const hash = await broadcast(
    account,
    [
      {
        typeUrl: REGISTER_KEM_KEY_TYPE_URL,
        value: { sender: account.cosmos, algorithmId: ALGORITHM_ML_KEM_1024, publicKey: keys.mlkemPublicKey },
      },
    ],
    "hybrid",
  );
  console.log(`ml-kem published ${account.cosmos}: ${hash}`);
  return hash;
}

export async function withEvmWindow<T>(
  name: string,
  spec: { txs: number; maxValueUqor: string; targets?: string[]; blocks?: number },
  body: (account: UnifiedAccount, hashes: { openHash: string }) => Promise<T>,
): Promise<{ result: T; openHash: string; closeHash: string }> {
  const account = await loadAccount(name);
  const openHash = await broadcast(
    account,
    [
      openEvmWindowMsg({
        sender: account.cosmos,
        blocks: spec.blocks ?? 120,
        maxTxs: spec.txs,
        maxValue: spec.maxValueUqor,
        allowedTargets: spec.targets && spec.targets.length > 0 ? spec.targets : undefined,
      }),
    ],
    "hybrid",
  );
  const win = await fetchEvmWindow({ rest: TESTNET.rest, address: account.cosmos });
  if (!win.live) throw new Error(`window ${openHash} did not become live`);
  let result!: T;
  let bodyError: unknown;
  try {
    result = await body(account, { openHash });
  } catch (error) {
    bodyError = error;
  }
  await new Promise((r) => setTimeout(r, 1000));
  const closeHash = await broadcast(account, [closeEvmWindowMsg(account.cosmos)], "hybrid");
  if (bodyError) throw bodyError;
  return { result, openHash, closeHash };
}

export async function sendScopedContractTx(opts: {
  account: UnifiedAccount;
  to: Address;
  data: Hex;
  value?: bigint;
}): Promise<Hex> {
  const client = evmClient();
  const signer = privateKeyToAccount(opts.account.privateKey as Hex);
  const wallet = createWalletClient({ account: signer, chain: qorechainDiana, transport: http(TESTNET.evmRpc) });
  const gas = await client.estimateGas({
    account: signer,
    to: opts.to,
    data: opts.data,
    value: opts.value ?? 0n,
  });
  const hash = await wallet.sendTransaction({
    to: opts.to,
    data: opts.data,
    value: opts.value ?? 0n,
    gas,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`EVM tx ${hash} reverted`);
  return hash;
}
