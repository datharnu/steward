import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { PAYMENT_HASH } from "./engine";

type ReceiptBody = Record<string, unknown>;

type SignedReceipt = {
  body: ReceiptBody;
  bodyHash: string;
  signerPubkeyHex: string;
  signatureHex: string;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((key) => obj[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`)
    .join(",")}}`;
}

function hexToBytes(hex: string): Uint8Array {
  const raw = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(raw.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bodyHashOf(body: ReceiptBody): string {
  return `0x${bytesToHex(keccak_256(utf8ToBytes(canonicalJson(body))))}`;
}

async function loadReceipt(): Promise<SignedReceipt> {
  const response = await fetch("/receipt.json");
  if (!response.ok) throw new Error("The receipt file did not load.");
  return (await response.json()) as SignedReceipt;
}

async function signatureChecks(receipt: SignedReceipt, hash: string): Promise<boolean> {
  const { pqVerify } = await import("@qorechain/qoresign");
  return pqVerify(
    hexToBytes(receipt.signerPubkeyHex),
    utf8ToBytes(`steward.receipt.v1|${hash.toLowerCase()}`),
    hexToBytes(receipt.signatureHex),
  );
}

/** Recompute the receipt hash and check the ML-DSA-87 signature in this browser. */
export async function checkReceipt(): Promise<void> {
  const receipt = await loadReceipt();
  const hash = bodyHashOf(receipt.body);
  if (hash.toLowerCase() !== receipt.bodyHash.toLowerCase()) {
    throw new Error("The receipt hash does not match its body.");
  }
  if (String(receipt.body.txHash).toLowerCase() !== PAYMENT_HASH.toLowerCase()) {
    throw new Error("This receipt is not the paid invoice.");
  }
  if (!(await signatureChecks(receipt, hash))) throw new Error("The ML-DSA signature does not check.");
}

/**
 * Change one character of the amount in memory, recompute the hash, and check the
 * original signature. The file at /receipt.json is left as it is.
 */
export async function checkTamperedReceipt(): Promise<string> {
  const receipt = await loadReceipt();
  const amount = String(receipt.body.amount ?? "");
  if (!/^\d+$/.test(amount)) throw new Error("The receipt has no amount to change.");
  const changed = `${amount.slice(0, -1)}${amount.endsWith("1") ? "2" : "1"}`;
  const hash = bodyHashOf({ ...receipt.body, amount: changed });
  if (hash.toLowerCase() === receipt.bodyHash.toLowerCase()) {
    throw new Error("The change did not alter the hash.");
  }
  if (await signatureChecks(receipt, hash)) {
    throw new Error("The altered receipt still checked. That should not happen.");
  }
  return `As expected. Changed the amount from ${amount} to ${changed} in memory and recomputed the hash. The file was not changed. The ML-DSA signature does not check.`;
}
