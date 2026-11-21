import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hexToBytes, type Hex } from "viem";
import { PAID_INVOICE_KEY } from "./engine.ts";
import { decodePayCall, invoiceKey, SIG_LEN } from "./pay-check.ts";


const calldata = readFileSync("lib/fixtures/pay-calldata.hex", "utf8").trim() as Hex;
const invoice = decodePayCall(calldata);

assert.ok(invoice, "the recorded call is PayGate.pay");
assert.equal(invoice.vendor, "0xf09cc23e992A4591A456836D7223655399D0BB90");
assert.equal(invoice.payee, invoice.vendor);
assert.equal(invoice.token, "0x97143B771D34ddb9130b807b135Ae675A5a963CA");
assert.equal(invoice.amount, 10_000n);
assert.equal(invoice.invoiceId, "0x56e6827aabe3eac43711ae3f090f28696ca4250512d82cfc99748ef75d150ce6");
assert.equal(invoiceKey(invoice.vendor, invoice.invoiceId), PAID_INVOICE_KEY);
assert.equal(hexToBytes(invoice.signature).length, SIG_LEN);
