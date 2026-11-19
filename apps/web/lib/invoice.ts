import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { GATE } from "./engine";

const TOKEN = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const CHAIN_ID = 9800n;

function keccakHex(bytes: Uint8Array): string {
  return `0x${bytesToHex(keccak_256(bytes))}`;
}

function pad32(hex: string): string {
  return hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

/** ABI encoding of the static VendorSig fields. Same bytes as haven-pq-kit `encodeInvoice`. */
export function encodeInvoiceMessage(fields: {
  vendor: string;
  payee: string;
  amount: bigint;
  invoiceId: string;
  dueDate: bigint;
  memoHash: string;
}): string {
  const domain = keccakHex(utf8ToBytes("haven-pq-kit.VendorSig.v1"));
  return `0x${[
    pad32(domain),
    pad32(CHAIN_ID.toString(16)),
    pad32(GATE),
    pad32(fields.vendor),
    pad32(fields.payee),
    pad32(TOKEN),
    pad32(fields.amount.toString(16)),
    pad32(fields.invoiceId),
    pad32(fields.dueDate.toString(16)),
    pad32(fields.memoHash),
  ].join("")}`;
}

export function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export type SignedInvoiceFile = {
  vendor: string;
  payee: string;
  token: string;
  amount: string;
  invoiceId: string;
  dueDate: number;
  memoHash: string;
  memoText: string;
  vendorSig: string;
  publicKey: string;
};

/** A new ML-DSA-87 key, used once in this tab. It is not registered on chain. */
export async function signInvoiceInBrowser(input: { payee: string; amount: bigint; memo: string }): Promise<SignedInvoiceFile> {
  if (!isAddress(input.payee)) throw new Error("The payout needs a 20-byte address.");
  if (input.amount <= 0n) throw new Error("The amount has to be more than zero.");
  const { pqKeyFromSeed, pqSign, pqVerify } = await import("@qorechain/qoresign");
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  const key = pqKeyFromSeed(seed);
  const memoHash = keccakHex(utf8ToBytes(input.memo));
  const invoiceId = keccakHex(utf8ToBytes(`browser-${bytesToHex(seed).slice(0, 16)}`));
  const dueDate = BigInt(Math.floor(Date.now() / 1000) + 86_400);
  const message = encodeInvoiceMessage({
    vendor: input.payee,
    payee: input.payee,
    amount: input.amount,
    invoiceId,
    dueDate,
    memoHash,
  });
  const raw = message.slice(2);
  const messageBytes = new Uint8Array(raw.length / 2);
  for (let i = 0; i < messageBytes.length; i += 1) messageBytes[i] = Number.parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  const signature = pqSign(key.secretKey, messageBytes);
  if (!pqVerify(key.publicKey, messageBytes, signature)) throw new Error("The new signature did not check.");
  return {
    vendor: input.payee,
    payee: input.payee,
    token: TOKEN,
    amount: input.amount.toString(),
    invoiceId,
    dueDate: Number(dueDate),
    memoHash,
    memoText: input.memo,
    vendorSig: `0x${bytesToHex(signature)}`,
    publicKey: `0x${bytesToHex(key.publicKey)}`,
  };
}
