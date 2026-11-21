/**
 * Reads the recorded pay transaction and checks it in PayGate's order.
 * `_checkInvoice` in `src/PayGate.sol` is token, amount, vendor, payee, unused id, then the signature.
 * `pay` checks the per-invoice cap and the daily cap after that.
 * The signed bytes are `VendorSig.encode` in `lib/haven-pq-kit/src/VendorSig.sol`.
 */
import {
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hexToBytes,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
/** Same addresses as `lib/engine.ts` and `lib/live.ts`. Kept here so the Node test can import this file. */
const GATE = "0xb0c44d0a628c4593314a5c3c113d27f2d1842a05";
const FUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const PAYMENT_HASH = "3DEB1D5B87F0BA09BA82E1A1042EA5A7508DF1305913CD451D8960B5C08B3F84";
const FUSD_BASE = 1_000_000n;

function formatFusd(base: bigint): string {
  const whole = base / FUSD_BASE;
  const frac = (base % FUSD_BASE).toString().padStart(6, "0");
  return `${whole.toString()}.${frac}`;
}

export const CHAIN_ID = 9800n;
export const PQC_STATUS = "0x0000000000000000000000000000000000000a02" as const;
export const ML_DSA_87 = 1;
export const PUBKEY_LEN = 2592;
export const SIG_LEN = 4627;
export const NETWORK = "Could not reach the testnet";
const RPC = "https://evm-testnet.qore.host";
const EXECUTE_EVM = "/qorechain.abstractaccount.v1.MsgExecuteEVM";

const DOMAIN: Hex = keccak256(toBytes("haven-pq-kit.VendorSig.v1"));

const payAbi = [
  {
    type: "function",
    name: "pay",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "invoice",
        type: "tuple",
        components: [
          { name: "vendor", type: "address" },
          { name: "payee", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "invoiceId", type: "bytes32" },
          { name: "dueDate", type: "uint256" },
          { name: "memoHash", type: "bytes32" },
        ],
      },
      { name: "vendorSig", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const readAbi = [
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  {
    type: "function",
    name: "vendors",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "active", type: "bool" },
      { name: "payout", type: "address" },
      { name: "perInvoiceCap", type: "uint256" },
      { name: "epoch", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "invoiceState",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "uint8" }],
  },
  { type: "function", name: "dailyCap", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

const pqcAbi = [
  {
    type: "function",
    name: "pqcKeyStatus",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "registered", type: "bool" },
      { name: "algorithmId", type: "uint8" },
      { name: "pubkey", type: "bytes" },
      { name: "possessionProven", type: "bool" },
    ],
  },
] as const;

export type LineState = "pass" | "fail" | "note";

export type PayLine = {
  label: string;
  detail: string;
  state: LineState;
};

export type PayInvoice = {
  vendor: Address;
  payee: Address;
  token: Address;
  amount: bigint;
  invoiceId: Hex;
  dueDate: bigint;
  memoHash: Hex;
  signature: Hex;
};

export class NetworkError extends Error {
  constructor() {
    super(NETWORK);
    this.name = "NetworkError";
  }
}

export function invoiceMessage(gate: Address, invoice: PayInvoice): Hex {
  return encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "uint256" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "bytes32" },
    ],
    [DOMAIN, CHAIN_ID, gate, invoice.vendor, invoice.payee, invoice.token, invoice.amount, invoice.invoiceId, invoice.dueDate, invoice.memoHash],
  );
}

export function invoiceKey(vendor: Address, invoiceId: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [vendor, invoiceId]));
}

export function decodePayCall(calldata: Hex): PayInvoice | null {
  try {
    const decoded = decodeFunctionData({ abi: payAbi, data: calldata });
    if (decoded.functionName !== "pay") return null;
    const invoice = decoded.args[0];
    const signature = decoded.args[1];
    return {
      vendor: getAddress(invoice.vendor),
      payee: getAddress(invoice.payee),
      token: getAddress(invoice.token),
      amount: invoice.amount,
      invoiceId: invoice.invoiceId,
      dueDate: invoice.dueDate,
      memoHash: invoice.memoHash,
      signature,
    };
  } catch {
    return null;
  }
}

type Reads = {
  token: Address;
  vendorActive: boolean;
  payout: Address;
  perInvoiceCap: bigint;
  invoiceState: number;
  dailyCap: bigint;
  registered: boolean;
  algorithmId: number;
  possession: boolean;
  pubkey: Uint8Array;
  signatureOk: boolean;
};

function stateWord(state: number): string {
  if (state === 2) return "Paid";
  if (state === 1) return "Queued";
  if (state === 0) return "Unused";
  return `state ${state}`;
}

/** The eight lines, in the order PayGate checks them. Notes are reads, not a second verdict. */
export function assessPay(invoice: PayInvoice, reads: Reads): PayLine[] {
  const tokenOk = invoice.token.toLowerCase() === reads.token.toLowerCase() && reads.token.toLowerCase() === FUSD.toLowerCase();
  const amountOk = invoice.amount > 0n;
  const vendorOk = reads.vendorActive;
  const payeeOk = invoice.payee.toLowerCase() === reads.payout.toLowerCase();
  const paidNow = reads.invoiceState === 2;
  const keyOk =
    reads.registered &&
    reads.algorithmId === ML_DSA_87 &&
    reads.possession &&
    reads.pubkey.length === PUBKEY_LEN &&
    reads.signatureOk &&
    hexToBytes(invoice.signature).length === SIG_LEN;
  const underInvoiceCap = invoice.amount <= reads.perInvoiceCap;

  return [
    {
      label: "Token",
      state: tokenOk ? "pass" : "fail",
      detail: tokenOk
        ? "The invoice names the fUSD PayGate holds."
        : `The invoice names ${invoice.token}. PayGate holds ${reads.token}.`,
    },
    {
      label: "Amount",
      state: amountOk ? "pass" : "fail",
      detail: amountOk
        ? `${formatFusd(invoice.amount)} fUSD. An amount of zero is refused before the signature.`
        : "The amount is zero. PayGate refuses that before the signature.",
    },
    {
      label: "Vendor",
      state: vendorOk ? "pass" : "fail",
      detail: vendorOk ? `${invoice.vendor} is an active vendor.` : `${invoice.vendor} is not an active vendor.`,
    },
    {
      label: "Payee",
      state: payeeOk ? "pass" : "fail",
      detail: payeeOk
        ? `The payee is the payout registered for this vendor, ${reads.payout}.`
        : `The payee is ${invoice.payee}. The registered payout is ${reads.payout}.`,
    },
    {
      label: "Invoice id",
      state: paidNow ? "note" : "fail",
      detail: paidNow
        ? `${invoice.invoiceId} is ${stateWord(reads.invoiceState)} now. PayGate checks that an id is unused before the signature. Paid is what this pay leaves. This line is not a claim that the id is unused today.`
        : `${invoice.invoiceId} is ${stateWord(reads.invoiceState)} now. A successful pay leaves Paid.`,
    },
    {
      label: "Signature",
      state: keyOk ? "pass" : "fail",
      detail: keyOk
        ? "The vendor's ML-DSA-87 signature matches the key registered now. PayGate checks this after the token, the amount, the vendor, the payee, and the unused id."
        : "The signature does not match the ML-DSA-87 key registered for this vendor now.",
    },
    {
      label: "Per-invoice cap",
      state: underInvoiceCap ? "note" : "fail",
      detail: underInvoiceCap
        ? `${formatFusd(invoice.amount)} is inside the per-invoice cap read now, ${formatFusd(reads.perInvoiceCap)}. pay checks this cap after the signature.`
        : `${formatFusd(invoice.amount)} is over the per-invoice cap read now, ${formatFusd(reads.perInvoiceCap)}. pay checks this cap after the signature.`,
    },
    {
      label: "Daily cap",
      state: "note",
      detail: `The daily cap read now is ${formatFusd(reads.dailyCap)}. pay checks the day's spend after the signature. The spend on the day of this payment is not in this read.`,
    },
  ];
}

export function payFailed(lines: PayLine[]): boolean {
  return lines.some((line) => line.state === "fail");
}

function bytesFromBase64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function rpc(method: string, params: unknown[]): Promise<string> {
  let response: Response;
  try {
    response = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch {
    throw new NetworkError();
  }
  if (!response.ok) throw new NetworkError();
  const body = (await response.json()) as { result?: string; error?: { message?: string } };
  if (!body.result || body.error) throw new NetworkError();
  return body.result;
}

async function readCall(data: Hex): Promise<string> {
  return rpc("eth_call", [{ to: GATE, data }, "latest"]);
}

export async function checkRecordedPay(): Promise<PayLine[]> {
  const hash = PAYMENT_HASH.toUpperCase();
  let response: Response;
  try {
    response = await fetch(`/qore-rest/cosmos/tx/v1beta1/txs/${hash}`);
  } catch {
    throw new NetworkError();
  }
  if (!response.ok) throw new NetworkError();
  const body = (await response.json()) as {
    tx?: { body?: { messages?: Array<Record<string, string>> } };
    tx_response?: { code?: number };
  };
  if (body.tx_response?.code !== 0) {
    return [{ label: "Transaction", state: "fail", detail: "The recorded pay transaction did not succeed." }];
  }
  const message = (body.tx?.body?.messages ?? []).find((item) => item["@type"] === EXECUTE_EVM);
  if (!message?.data || !message.to) {
    return [{ label: "Transaction", state: "fail", detail: "The recorded transaction has no PayGate call." }];
  }
  let gate: Address;
  try {
    gate = getAddress(message.to);
  } catch {
    return [{ label: "Transaction", state: "fail", detail: "The call target is not an address." }];
  }
  if (gate.toLowerCase() !== GATE.toLowerCase()) {
    return [{ label: "Transaction", state: "fail", detail: `The call went to ${gate}, not PayGate.` }];
  }
  const calldata = `0x${Array.from(bytesFromBase64(message.data), (byte) => byte.toString(16).padStart(2, "0")).join("")}` as Hex;
  const invoice = decodePayCall(calldata);
  if (!invoice) {
    return [{ label: "Transaction", state: "fail", detail: "The call is not PayGate.pay." }];
  }

  let tokenRaw: string;
  let vendorRaw: string;
  let stateRaw: string;
  let capRaw: string;
  let keyRaw: string;
  try {
    const keyData = encodeFunctionData({ abi: pqcAbi, functionName: "pqcKeyStatus", args: [invoice.vendor] });
    [tokenRaw, vendorRaw, stateRaw, capRaw, keyRaw] = await Promise.all([
      readCall(encodeFunctionData({ abi: readAbi, functionName: "token" })),
      readCall(encodeFunctionData({ abi: readAbi, functionName: "vendors", args: [invoice.vendor] })),
      readCall(encodeFunctionData({ abi: readAbi, functionName: "invoiceState", args: [invoiceKey(invoice.vendor, invoice.invoiceId)] })),
      readCall(encodeFunctionData({ abi: readAbi, functionName: "dailyCap" })),
      rpc("eth_call", [{ to: PQC_STATUS, data: keyData }, "latest"]),
    ]);
  } catch (error) {
    if (error instanceof NetworkError) throw error;
    throw new NetworkError();
  }

  const token = decodeFunctionResult({ abi: readAbi, functionName: "token", data: tokenRaw as Hex });
  const vendor = decodeFunctionResult({ abi: readAbi, functionName: "vendors", data: vendorRaw as Hex });
  const state = decodeFunctionResult({ abi: readAbi, functionName: "invoiceState", data: stateRaw as Hex });
  const dailyCap = decodeFunctionResult({ abi: readAbi, functionName: "dailyCap", data: capRaw as Hex });
  const key = decodeFunctionResult({ abi: pqcAbi, functionName: "pqcKeyStatus", data: keyRaw as Hex });
  const pubkey = hexToBytes(key[2]);
  const { pqVerify } = await import("@qorechain/qoresign");
  const signatureOk =
    hexToBytes(invoice.signature).length === SIG_LEN &&
    pubkey.length === PUBKEY_LEN &&
    pqVerify(pubkey, hexToBytes(invoiceMessage(gate, invoice)), hexToBytes(invoice.signature)) === true;

  return assessPay(invoice, {
    token: getAddress(token),
    vendorActive: vendor[0] === true,
    payout: getAddress(vendor[1]),
    perInvoiceCap: vendor[2],
    invoiceState: Number(state),
    dailyCap,
    registered: key[0] === true,
    algorithmId: Number(key[1]),
    possession: key[3] === true,
    pubkey,
    signatureOk,
  });
}
