import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { pqVerify } from "@qorechain/qoresign";
import { readMlDsaKey, requireMlDsaKey } from "haven-pq-kit";
import { hexToBytes, type Address, type Hex, type PublicClient } from "viem";
import { encodePayGateInvoiceMessage } from "../src/ts/paygate.js";
import { type InvoiceRecord } from "../src/ts/policy.js";

export type InboxItem = {
  id: string;
  source: "file" | "courier" | "upload";
  invoice: InvoiceRecord;
};

export interface InboxAdapter {
  listPending(): Promise<InboxItem[]>;
  markHandled(id: string): Promise<void>;
}

/** Reads JSON invoice files from a directory and moves handled ones to `processed/`. */
export class FileInboxAdapter implements InboxAdapter {
  readonly dir: string;
  readonly processedDir: string;

  constructor(dir = "inbox") {
    this.dir = dir;
    this.processedDir = join(dir, "processed");
  }

  async listPending(): Promise<InboxItem[]> {
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    return files.map((file) => {
      const raw = JSON.parse(readFileSync(join(this.dir, file), "utf8")) as InvoiceRecord;
      return { id: file, source: "file", invoice: raw };
    });
  }

  async markHandled(id: string): Promise<void> {
    const src = join(this.dir, id);
    if (!existsSync(src)) return;
    mkdirSync(this.processedDir, { recursive: true });
    renameSync(src, join(this.processedDir, id));
  }
}

/**
 * Placeholder adapter for Courier (`qor1` post-quantum sealed invoice messages).
 * Once Courier is running, this pulls authenticated Courier envelopes of type
 * `"invoice"` and passes their inner signed `InvoiceRecord` into Steward.
 */
export class CourierInboxAdapter implements InboxAdapter {
  private readonly queue: InboxItem[] = [];

  enqueueFromCourier(id: string, invoice: InvoiceRecord): void {
    this.queue.push({ id, source: "courier", invoice });
  }

  async listPending(): Promise<InboxItem[]> {
    return [...this.queue];
  }

  async markHandled(id: string): Promise<void> {
    const idx = this.queue.findIndex((item) => item.id === id);
    if (idx >= 0) this.queue.splice(idx, 1);
  }
}

export async function verifyInvoiceOffChain(args: {
  client: PublicClient;
  chainId: bigint;
  gate: Address;
  invoice: InvoiceRecord;
}): Promise<{ valid: boolean; reason?: string }> {
  try {
    const key = await readMlDsaKey(args.client, args.invoice.vendor);
    requireMlDsaKey(key);
    const msg = encodePayGateInvoiceMessage({
      chainId: args.chainId,
      gate: args.gate,
      vendor: args.invoice.vendor,
      payee: args.invoice.payee,
      token: args.invoice.token,
      amount: BigInt(args.invoice.amount),
      invoiceId: args.invoice.invoiceId,
      dueDate: BigInt(args.invoice.dueDate),
      memoHash: args.invoice.memoHash,
    });
    const ok = pqVerify(hexToBytes(key.pubkey), hexToBytes(msg), hexToBytes(args.invoice.vendorSig));
    return ok ? { valid: true } : { valid: false, reason: "ML-DSA-87 vendor signature invalid" };
  } catch (err) {
    return { valid: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
