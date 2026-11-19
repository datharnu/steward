import { GATE, PAID_INVOICE_KEY, VENDOR } from "./engine";

const RPC = "https://evm-testnet.qore.host";
const FUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";

const SELECTOR = {
  balanceOf: "0x70a08231",
  paused: "0x5c975abb",
  spentToday: "0xf059cf2b",
  dailyCap: "0xeb339391",
  vendors: "0x27e30c36",
  invoiceState: "0x163acf15",
} as const;

export type GateLive = {
  balance: bigint;
  paused: boolean;
  spentToday: bigint;
  dailyCap: bigint;
  perInvoiceCap: bigint;
  payout: string;
  invoiceState: number;
};

async function ethCall(to: string, data: string): Promise<string> {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
  });
  if (!response.ok) throw new Error(`http ${response.status}`);
  const body = (await response.json()) as { result?: string; error?: { message: string } };
  if (!body.result || body.error) throw new Error(body.error?.message ?? "no result");
  return body.result;
}

function word(hex: string, index: number): bigint {
  const start = 2 + index * 64;
  return BigInt(`0x${hex.slice(start, start + 64)}`);
}

export async function readGate(): Promise<GateLive> {
  const vendorWord = VENDOR.slice(2).toLowerCase().padStart(64, "0");
  const keyWord = PAID_INVOICE_KEY.slice(2).toLowerCase().padStart(64, "0");
  const [balance, paused, spent, cap, vendor, state] = await Promise.all([
    ethCall(FUSD, SELECTOR.balanceOf + GATE.slice(2).padStart(64, "0")),
    ethCall(GATE, SELECTOR.paused),
    ethCall(GATE, SELECTOR.spentToday),
    ethCall(GATE, SELECTOR.dailyCap),
    ethCall(GATE, SELECTOR.vendors + vendorWord),
    ethCall(GATE, SELECTOR.invoiceState + keyWord),
  ]);
  return {
    balance: word(balance, 0),
    paused: word(paused, 0) !== 0n,
    spentToday: word(spent, 0),
    dailyCap: word(cap, 0),
    perInvoiceCap: word(vendor, 2),
    payout: `0x${vendor.slice(2 + 64 + 24, 2 + 128)}`,
    invoiceState: Number(word(state, 0)),
  };
}

export function invoiceLabel(state: number): string {
  if (state === 2) return "Paid";
  if (state === 1) return "Queued";
  return "Unused";
}
