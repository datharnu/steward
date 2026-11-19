import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACTION_APPROVE,
  ACTION_PROPOSE,
  PayGateOp,
  approveArgsHash,
  encodeAddVendorParams,
  encodePayGateInvoiceMessage,
  encodePayGateOwnerMessage,
  encodeSetPayoutParams,
  invoiceKey,
  opHashOf,
} from "../src/ts/paygate.js";

const vectors = JSON.parse(readFileSync("vectors/messages.json", "utf8"));

describe("PayGate byte vectors", () => {
  it("matches invoice key, op hashes, and approve args hash", () => {
    expect(invoiceKey(vectors.vendor, vectors.approve.invoiceId)).toBe(vectors.invoiceKey);
    const addParams = encodeAddVendorParams(vectors.vendor, vectors.payout, 1_000_000_000n);
    expect(addParams).toBe(vectors.addVendor.params);
    expect(opHashOf(PayGateOp.AddVendor, addParams)).toBe(vectors.addVendor.opHash);

    const payoutParams = encodeSetPayoutParams(vectors.vendor, vectors.payout);
    expect(payoutParams).toBe(vectors.setPayout.params);
    expect(opHashOf(PayGateOp.SetPayout, payoutParams)).toBe(vectors.setPayout.opHash);

    expect(
      approveArgsHash(
        vectors.vendor,
        vectors.approve.invoiceId,
        vectors.payout,
        BigInt(vectors.approve.amount),
      ),
    ).toBe(vectors.approve.argsHash);
  });

  it("matches invoice message bytes", () => {
    const msg = encodePayGateInvoiceMessage({
      chainId: BigInt(vectors.invoice.chainId),
      gate: vectors.invoice.gate,
      vendor: vectors.invoice.vendor,
      payee: vectors.invoice.payee,
      token: vectors.invoice.token,
      amount: BigInt(vectors.invoice.amount),
      invoiceId: vectors.invoice.invoiceId,
      dueDate: BigInt(vectors.invoice.dueDate),
      memoHash: vectors.invoice.memoHash,
    });
    expect(msg).toBe(vectors.invoice.message);
  });

  it("matches owner PqAuth message bytes", () => {
    expect(vectors.ownerPropose.action).toBe(ACTION_PROPOSE);
    expect(vectors.ownerApprove.action).toBe(ACTION_APPROVE);

    const proposeMsg = encodePayGateOwnerMessage({
      chainId: BigInt(vectors.ownerPropose.chainId),
      contract: vectors.ownerPropose.contract,
      signer: vectors.ownerPropose.signer,
      action: vectors.ownerPropose.action,
      nonce: BigInt(vectors.ownerPropose.nonce),
      deadline: BigInt(vectors.ownerPropose.deadline),
      argsHash: vectors.ownerPropose.argsHash,
    });
    expect(proposeMsg).toBe(vectors.ownerPropose.message);

    const approveMsg = encodePayGateOwnerMessage({
      chainId: BigInt(vectors.ownerApprove.chainId),
      contract: vectors.ownerApprove.contract,
      signer: vectors.ownerApprove.signer,
      action: vectors.ownerApprove.action,
      nonce: BigInt(vectors.ownerApprove.nonce),
      deadline: BigInt(vectors.ownerApprove.deadline),
      argsHash: vectors.ownerApprove.argsHash,
    });
    expect(approveMsg).toBe(vectors.ownerApprove.message);
  });
});
