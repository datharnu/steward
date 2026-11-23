import { pqSign, pqVerify } from "@qorechain/qoresign";
import { keccak256, toBytes, toHex, hexToBytes, type Address, type Hex } from "viem";
import { canonicalJson } from "./mandate.js";
import { type DecisionCode, type PlannerAction } from "./policy.js";

export const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;
export const RECEIPT_DOMAIN = "steward.receipt.v1";

export type ReceiptTxStatus = "none" | "confirmed" | "failed_execution" | "rejected" | "unknown";

export type ReceiptBody = {
  seq: number;
  prevHash: Hex;
  timestamp: number;
  chainId: string;
  gate: Address;
  mandateId: string;
  invoiceKey: Hex;
  vendor: Address;
  invoiceId: Hex;
  amount: string;
  /**
   * Which planner proposed the action (`llm:<provider>:<model>[:unguarded]`, `rule-based`, or
   * `rule-based (fallback from llm:...)`). Added after the first recorded receipt; receipts
   * written before it have no such key, and `canonicalJson` skips absent keys, so their hashes
   * and signatures still verify unchanged.
   */
  planner?: string;
  plannerAction: PlannerAction;
  plannerReason: string;
  finalAction: PlannerAction;
  decisionCode: DecisionCode;
  decisionReason: string;
  txHash?: string;
  txStatus: ReceiptTxStatus;
};

export type SignedReceipt = {
  body: ReceiptBody;
  bodyHash: Hex;
  signerPubkeyHex: Hex;
  signatureHex: Hex;
};

export function hashReceiptBody(body: ReceiptBody): Hex {
  return keccak256(toBytes(canonicalJson(body)));
}

export function receiptSigningBytes(bodyHash: Hex): Uint8Array {
  return toBytes(`${RECEIPT_DOMAIN}|${bodyHash.toLowerCase()}`);
}

export function signReceipt(args: {
  body: ReceiptBody;
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}): SignedReceipt {
  const bodyHash = hashReceiptBody(args.body);
  const sig = pqSign(args.secretKey, receiptSigningBytes(bodyHash));
  return {
    body: args.body,
    bodyHash,
    signerPubkeyHex: toHex(args.publicKey),
    signatureHex: toHex(sig),
  };
}

export type ReceiptChainCheck =
  | { valid: true; count: number; headHash: Hex }
  | { valid: false; index: number; error: string };

export function verifyReceiptChain(
  receipts: readonly SignedReceipt[],
  expectedPubkeyHex?: Hex,
): ReceiptChainCheck {
  let expectedPrev = ZERO_HASH;
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];
    if (r.body.seq !== i) {
      return { valid: false, index: i, error: `expected seq ${i}, got ${r.body.seq}` };
    }
    if (r.body.prevHash.toLowerCase() !== expectedPrev.toLowerCase()) {
      return {
        valid: false,
        index: i,
        error: `broken chain at seq ${i}: prevHash ${r.body.prevHash} != ${expectedPrev}`,
      };
    }
    const recomputed = hashReceiptBody(r.body);
    if (recomputed.toLowerCase() !== r.bodyHash.toLowerCase()) {
      return { valid: false, index: i, error: `bodyHash mismatch at seq ${i}` };
    }
    if (expectedPubkeyHex && r.signerPubkeyHex.toLowerCase() !== expectedPubkeyHex.toLowerCase()) {
      return { valid: false, index: i, error: `unexpected signer pubkey at seq ${i}` };
    }
    const ok = pqVerify(
      hexToBytes(r.signerPubkeyHex),
      receiptSigningBytes(r.bodyHash),
      hexToBytes(r.signatureHex),
    );
    if (!ok) {
      return { valid: false, index: i, error: `invalid ML-DSA-87 receipt signature at seq ${i}` };
    }
    expectedPrev = r.bodyHash;
  }
  return { valid: true, count: receipts.length, headHash: expectedPrev };
}
