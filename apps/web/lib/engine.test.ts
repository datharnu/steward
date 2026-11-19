import assert from "node:assert/strict";
import { RECORDED_LEFT, RECORDED_PAYMENT, RECORDED_START, formatFusd, judge } from "./engine.ts";

assert.equal(formatFusd(RECORDED_START), "0.021932");
assert.equal(formatFusd(RECORDED_PAYMENT), "0.010000");
assert.equal(formatFusd(RECORDED_LEFT), "0.011932");

const base = {
  mode: "try" as const,
  amount: RECORDED_PAYMENT,
  payee: "vendor" as const,
  stamp: "valid" as const,
  ask: "pay" as const,
  sameInvoice: false,
  drawer: RECORDED_LEFT,
};

const recorded = judge({ ...base, mode: "record" });
assert.equal(recorded.mark, "Recorded");
assert.equal(recorded.gateBefore, RECORDED_START);
assert.equal(recorded.gateAfter, RECORDED_LEFT);
assert.equal(recorded.vendorAfter, RECORDED_PAYMENT);

const again = judge({ ...base, sameInvoice: true });
assert.equal(again.code, "InvoiceUsed");
assert.equal(again.gateAfter, again.gateBefore);

const transfer = judge({ ...base, ask: "transfer" });
assert.equal(transfer.state, "refused");
assert.equal(transfer.mark, "Already tested");
assert.equal(transfer.gateAfter, RECORDED_LEFT);

const other = judge({ ...base, payee: "other", amount: 5_000n });
assert.equal(other.code, "WrongPayee");

const over = judge({ ...base, amount: 20_001n });
assert.equal(over.code, "OverInvoiceCap");
assert.equal(over.gateAfter, over.gateBefore);

const queued = judge({ ...base, ask: "queue", amount: 20_001n });
assert.equal(queued.state, "queued");
assert.equal(queued.gateAfter, queued.gateBefore);

const short = judge({ ...base, amount: 11_933n });
assert.equal(short.code, "InsufficientFunds");

const next = judge({ ...base, amount: 6_000n });
assert.equal(next.state, "paid");
assert.equal(next.mark, "Example");
assert.equal(next.gateAfter, 5_932n);
assert.equal(next.vendorAfter, 16_000n);

console.log("engine ok");
