import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pqVerify } from "@qorechain/qoresign";
import { readMlDsaKey, requireMlDsaKey, SIG_LEN } from "haven-pq-kit";
import { hexToBytes, keccak256, type Address, type Hex, type PublicClient } from "viem";
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
 * Courier's decrypted invoice message: `{ t: "invoice" } & Invoice` from Courier's
 * `src/ts/invoice.ts` (github.com/datharnu/courier). Courier signs it with `signInvoice`
 * over the same `VendorSig.encode` bytes PayGate checks, and carries the memo text whose
 * keccak256 is `memoHash`.
 */
export type CourierInvoicePayload = {
  t: "invoice";
  gate: string;
  vendor: string;
  payee: string;
  token: string;
  amount: string;
  invoiceId: string;
  dueDate: number;
  memoHash: string;
  memo: string;
  vendorSig: string;
};

/** One accepted item from Courier's `CourierClient.receive()` (its `Received` type with `ok: true`). */
export type CourierReceived = {
  ok: true;
  seq: number;
  from: string;
  conversationId: string;
  counter: number;
  payload: { t: string } & Record<string, unknown>;
  first: boolean;
  ciphertextHash: string;
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const WORD_RE = /^0x[0-9a-fA-F]{64}$/;
const AMOUNT_RE = /^[1-9][0-9]{0,77}$/;

export type CourierParse =
  | { kind: "invoice"; invoice: InvoiceRecord; from?: string; ciphertextHash?: string }
  | { kind: "not-invoice"; type: string }
  | { kind: "refused"; reason: string };

/**
 * Turn one Courier drop file (a `Received` item or a bare invoice payload) into an
 * `InvoiceRecord`. Repeats Courier's own `checkInvoice` shape checks, then adds Steward's:
 * the invoice must be signed for this gate, and when Courier names the sender, the sender
 * must be the vendor. The ML-DSA-87 signature is checked separately by the adapter.
 */
export function parseCourierDrop(raw: unknown, opts: { gate: Address; requireSenderIsVendor?: boolean }): CourierParse {
  if (!raw || typeof raw !== "object") return { kind: "refused", reason: "not a JSON object" };
  const obj = raw as Record<string, unknown>;
  let payload: Record<string, unknown> = obj;
  let from: string | undefined;
  let ciphertextHash: string | undefined;
  if ("payload" in obj) {
    if (obj.ok !== true) return { kind: "refused", reason: "Courier did not accept this message (ok is not true)" };
    payload = (obj.payload ?? {}) as Record<string, unknown>;
    from = typeof obj.from === "string" ? obj.from : undefined;
    ciphertextHash = typeof obj.ciphertextHash === "string" ? obj.ciphertextHash : undefined;
  }
  if (payload.t !== "invoice") return { kind: "not-invoice", type: String(payload.t ?? "unknown") };
  const p = payload as Partial<CourierInvoicePayload>;
  for (const field of ["gate", "vendor", "payee", "token"] as const) {
    if (!ADDRESS_RE.test(String(p[field] ?? ""))) return { kind: "refused", reason: `${field} is not an address` };
  }
  if (!WORD_RE.test(String(p.invoiceId ?? ""))) return { kind: "refused", reason: "invoiceId is not 32 bytes" };
  if (!WORD_RE.test(String(p.memoHash ?? ""))) return { kind: "refused", reason: "memoHash is not 32 bytes" };
  if (typeof p.vendorSig !== "string" || !/^0x[0-9a-fA-F]+$/.test(p.vendorSig) || (p.vendorSig.length - 2) / 2 !== SIG_LEN) {
    return { kind: "refused", reason: "the vendor signature is not an ML-DSA-87 signature" };
  }
  if (typeof p.amount !== "string" || !AMOUNT_RE.test(p.amount) || BigInt(p.amount) > 2n ** 256n - 1n) {
    return { kind: "refused", reason: "the amount is not a positive uint256" };
  }
  if (typeof p.dueDate !== "number" || !Number.isSafeInteger(p.dueDate) || p.dueDate < 0) {
    return { kind: "refused", reason: "the due date is not a unix second" };
  }
  if (typeof p.memo !== "string" || p.memo.length === 0 || p.memo.length > 2048) {
    return { kind: "refused", reason: "the memo is empty or longer than 2048 characters" };
  }
  if (keccak256(new TextEncoder().encode(p.memo)).toLowerCase() !== p.memoHash!.toLowerCase()) {
    return { kind: "refused", reason: "the memo is not the one that was signed" };
  }
  if (p.gate!.toLowerCase() !== opts.gate.toLowerCase()) {
    return { kind: "refused", reason: `invoice is signed for gate ${p.gate}, not ${opts.gate}` };
  }
  if ((opts.requireSenderIsVendor ?? true) && from !== undefined && from.toLowerCase() !== p.vendor!.toLowerCase()) {
    return { kind: "refused", reason: `Courier sender ${from} is not the vendor ${p.vendor}` };
  }
  return {
    kind: "invoice",
    from,
    ciphertextHash,
    invoice: {
      vendor: p.vendor as Address,
      payee: p.payee as Address,
      token: p.token as Address,
      amount: p.amount,
      invoiceId: p.invoiceId as Hex,
      dueDate: p.dueDate,
      memoHash: p.memoHash as Hex,
      memoText: p.memo,
      vendorSig: p.vendorSig as Hex,
    },
  };
}

/** Check a vendor's ML-DSA-87 signature over `VendorSig.encode` for this chain and gate. */
export function verifyInvoiceSignature(args: {
  pubkey: Uint8Array;
  chainId: bigint;
  gate: Address;
  invoice: InvoiceRecord;
}): boolean {
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
  try {
    return pqVerify(args.pubkey, hexToBytes(msg), hexToBytes(args.invoice.vendorSig));
  } catch {
    return false;
  }
}

export type CourierRejection = { id: string; reason: string };

/**
 * Reads invoices Courier delivered and opened. Courier keeps plaintext on the receiving
 * device and has no export of its own, so the contract is a drop directory: the receiving
 * Courier device writes each accepted `receive()` item (or the bare `{ t: "invoice", ... }`
 * payload) as one JSON file. This adapter
 *  - repeats Courier's invoice checks (`parseCourierDrop`),
 *  - checks the vendor's ML-DSA-87 signature against the vendor's key (`vendorKey`, which
 *    reads `pqcKeyStatus` on chain in production),
 *  - moves refused files to `rejected/` with a `.reason.txt`, non-invoice messages to
 *    `ignored/`, and handled invoices to `processed/`.
 * The runner then checks the signature again, runs the policy, and PayGate checks it a third time.
 */
export class CourierInboxAdapter implements InboxAdapter {
  readonly dir: string;
  private readonly gate: Address;
  private readonly chainId: bigint;
  private readonly vendorKey: (vendor: Address) => Promise<Uint8Array>;
  private readonly requireSenderIsVendor: boolean;
  private rejectedItems: CourierRejection[] = [];

  constructor(opts: {
    dir: string;
    gate: Address;
    chainId: bigint;
    vendorKey: (vendor: Address) => Promise<Uint8Array>;
    requireSenderIsVendor?: boolean;
  }) {
    this.dir = opts.dir;
    this.gate = opts.gate;
    this.chainId = opts.chainId;
    this.vendorKey = opts.vendorKey;
    this.requireSenderIsVendor = opts.requireSenderIsVendor ?? true;
  }

  /** Files refused by the last `listPending` call, with the reason. */
  rejected(): readonly CourierRejection[] {
    return this.rejectedItems;
  }

  private moveTo(sub: string, id: string, reason?: string): void {
    const target = join(this.dir, sub);
    mkdirSync(target, { recursive: true });
    renameSync(join(this.dir, id), join(target, id));
    if (reason) writeFileSync(join(target, `${id}.reason.txt`), `${reason}\n`);
  }

  async listPending(): Promise<InboxItem[]> {
    this.rejectedItems = [];
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    const out: InboxItem[] = [];
    for (const file of files) {
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(join(this.dir, file), "utf8"));
      } catch {
        this.reject(file, "not valid JSON");
        continue;
      }
      const parsed = parseCourierDrop(raw, { gate: this.gate, requireSenderIsVendor: this.requireSenderIsVendor });
      if (parsed.kind === "not-invoice") {
        this.moveTo("ignored", file);
        continue;
      }
      if (parsed.kind === "refused") {
        this.reject(file, parsed.reason);
        continue;
      }
      let pubkey: Uint8Array;
      try {
        pubkey = await this.vendorKey(parsed.invoice.vendor);
      } catch (err) {
        this.reject(file, `no ML-DSA-87 key for vendor: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      if (!verifyInvoiceSignature({ pubkey, chainId: this.chainId, gate: this.gate, invoice: parsed.invoice })) {
        this.reject(file, "ML-DSA-87 vendor signature invalid");
        continue;
      }
      out.push({ id: file, source: "courier", invoice: parsed.invoice });
    }
    return out;
  }

  private reject(id: string, reason: string): void {
    this.rejectedItems.push({ id, reason });
    this.moveTo("rejected", id, reason);
  }

  async markHandled(id: string): Promise<void> {
    if (!existsSync(join(this.dir, id))) return;
    this.moveTo("processed", id);
  }
}

/** Production key reader for `CourierInboxAdapter`: the vendor's registered key from `pqcKeyStatus`. */
export function onChainVendorKey(client: PublicClient): (vendor: Address) => Promise<Uint8Array> {
  return async (vendor) => {
    const key = await readMlDsaKey(client, vendor);
    requireMlDsaKey(key);
    return hexToBytes(key.pubkey);
  };
}

export async function verifyInvoiceOffChain(args: {
  client: PublicClient;
  chainId: bigint;
  gate: Address;
  invoice: InvoiceRecord;
}): Promise<{ valid: boolean; reason?: string }> {
  try {
    const pubkey = await onChainVendorKey(args.client)(args.invoice.vendor);
    const ok = verifyInvoiceSignature({ pubkey, chainId: args.chainId, gate: args.gate, invoice: args.invoice });
    return ok ? { valid: true } : { valid: false, reason: "ML-DSA-87 vendor signature invalid" };
  } catch (err) {
    return { valid: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
