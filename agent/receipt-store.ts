import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { toHex, type Hex } from "viem";
import {
  ZERO_HASH,
  signReceipt,
  verifyReceiptChain,
  type ReceiptBody,
  type SignedReceipt,
} from "../src/ts/receipts.js";

/** Persistent JSONL hash-chained log of Steward's decisions, signed with ML-DSA-87. */
export class ReceiptStore {
  readonly path: string;
  private receipts: SignedReceipt[] = [];

  constructor(path = "agent-state/receipts.jsonl", expectedPubkey?: Uint8Array) {
    this.path = path;
    if (existsSync(path)) {
      const lines = readFileSync(path, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      this.receipts = lines.map((l) => JSON.parse(l) as SignedReceipt);
      const check = verifyReceiptChain(this.receipts, expectedPubkey ? toHex(expectedPubkey) : undefined);
      if (!check.valid) {
        throw new Error(`receipt log corrupted at index ${check.index}: ${check.error}`);
      }
    }
  }

  all(): readonly SignedReceipt[] {
    return this.receipts;
  }

  nextSeq(): number {
    return this.receipts.length;
  }

  headHash(): Hex {
    return this.receipts.length === 0 ? ZERO_HASH : this.receipts[this.receipts.length - 1].bodyHash;
  }

  append(args: {
    bodyWithoutChain: Omit<ReceiptBody, "seq" | "prevHash">;
    secretKey: Uint8Array;
    publicKey: Uint8Array;
  }): SignedReceipt {
    const body: ReceiptBody = {
      seq: this.nextSeq(),
      prevHash: this.headHash(),
      ...args.bodyWithoutChain,
    };
    const signed = signReceipt({
      body,
      secretKey: args.secretKey,
      publicKey: args.publicKey,
    });
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(signed)}\n`);
    this.receipts.push(signed);
    return signed;
  }
}
