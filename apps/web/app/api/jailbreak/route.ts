import { pqVerify } from "@qorechain/qoresign";
import { createJailbreakHandler } from "@/lib/jailbreak/handler";
import { invoiceMessage } from "@/lib/pay-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One handler per server instance: its rate limits and the Claude daily cap live in this memory.
const handler = createJailbreakHandler({
  env: {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    STEWARD_CLAUDE_DAILY_CAP: process.env.STEWARD_CLAUDE_DAILY_CAP,
    STEWARD_JAILBREAK_PER_MINUTE: process.env.STEWARD_JAILBREAK_PER_MINUTE,
    STEWARD_JAILBREAK_PER_DAY: process.env.STEWARD_JAILBREAK_PER_DAY,
  },
  pqVerify,
  invoiceMessage: (gate, invoice) =>
    invoiceMessage(gate, {
      vendor: invoice.vendor,
      payee: invoice.payee,
      token: invoice.token,
      amount: BigInt(invoice.amount),
      invoiceId: invoice.invoiceId,
      dueDate: BigInt(invoice.dueDate),
      memoHash: invoice.memoHash,
      signature: invoice.vendorSig,
    }),
});

export function GET(): Promise<Response> {
  return handler.GET();
}

export function POST(req: Request): Promise<Response> {
  return handler.POST(req);
}
