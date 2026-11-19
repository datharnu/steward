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

/** Recompute the receipt hash and check the ML-DSA-87 signature in this browser. */
export async function checkReceipt(): Promise<void> {
  const response = await fetch("/receipt.json");
  if (!response.ok) throw new Error("The receipt file did not load.");
  const receipt = (await response.json()) as SignedReceipt;
  const hash = `0x${bytesToHex(keccak_256(utf8ToBytes(canonicalJson(receipt.body))))}`;
  if (hash.toLowerCase() !== receipt.bodyHash.toLowerCase()) {
    throw new Error("The receipt hash does not match its body.");
  }
  if (String(receipt.body.txHash).toLowerCase() !== PAYMENT_HASH.toLowerCase()) {
    throw new Error("This receipt is not the paid invoice.");
  }
  const { pqVerify } = await import("@qorechain/qoresign");
  const ok = pqVerify(
    hexToBytes(receipt.signerPubkeyHex),
    utf8ToBytes(`steward.receipt.v1|${hash.toLowerCase()}`),
    hexToBytes(receipt.signatureHex),
  );
  if (!ok) throw new Error("The ML-DSA signature does not check.");
}
