/** Amounts are fUSD base units. 1 fUSD = 1_000_000. Recorded on 19 Nov 2026. */

export const FUSD_BASE = 1_000_000n;
export const RECORDED_START = 21_932n;
export const RECORDED_PAYMENT = 10_000n;
export const RECORDED_LEFT = 11_932n;
export const PER_INVOICE_CAP = 20_000n;
export const PAYMENT_HASH = "3DEB1D5B87F0BA09BA82E1A1042EA5A7508DF1305913CD451D8960B5C08B3F84";
export const INJECT_HASH = "43309EEA26AA0B9BFEEAD6B3996C446417AE4BF5F8AB75CD94A6995BD9255B03";
export const FORGED_HASH = "75FF835453F1A80F2F98D6F0ACD21EBC9D0F193D3FC8D4A2D3FDB91D9963D36D";
export const REPLAY_HASH = "27F14DE41D592DB0C9E3A60D81296C81FEE4C2BC644AF56E724EE5183D731BC0";
export const TRANSFER_HASH = "92854431F2D83B45BD7E4D501E7595BC1B1DAF21C300CC7B99E8ECC3D7028789";
export const QUEUE_HASH = "44331E7905651F0B8F49A787ECCADE4CD1F5FF5B51B9FD2AD92C29044F41443E";
export const PAID_INVOICE_KEY = "0xfb17c786a5b4e800302332af905216d5e80261e30d100c3e40fdd1a7771475a3";
export const GATE = "0xb0c44d0a628c4593314a5c3c113d27f2d1842a05";
export const VENDOR = "0xf09cc23e992A4591A456836D7223655399D0BB90";

export type Ask = "pay" | "queue" | "transfer";
export type Mark = "Recorded" | "Example" | "Already tested";

export type Verdict = {
  state: "paid" | "queued" | "refused";
  code: string;
  reason: string;
  gateBefore: bigint;
  gateAfter: bigint;
  vendorAfter: bigint;
  mark: Mark;
  source: string;
};

export function formatFusd(base: bigint): string {
  const neg = base < 0n;
  const value = neg ? -base : base;
  const whole = value / FUSD_BASE;
  const frac = (value % FUSD_BASE).toString().padStart(6, "0");
  return `${neg ? "−" : ""}${whole.toString()}.${frac}`;
}

export function shortAddress(value: string): string {
  if (value.length < 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

const still = (drawer: bigint, extra: Omit<Verdict, "gateBefore" | "gateAfter" | "vendorAfter">): Verdict => ({
  ...extra,
  gateBefore: drawer,
  gateAfter: drawer,
  vendorAfter: RECORDED_PAYMENT,
});

/**
 * What the clerk would do. `drawer` is the fUSD still in the gate.
 * The recorded payment is a special case: that invoice already settled, from 0.021932 to 0.011932.
 */
export function judge(input: {
  mode: "record" | "try";
  amount: bigint;
  payee: "vendor" | "other";
  stamp: "valid" | "forged";
  ask: Ask;
  sameInvoice: boolean;
  drawer: bigint;
}): Verdict {
  const { mode, amount, payee, stamp, ask, sameInvoice, drawer } = input;

  if (mode === "record") {
    return {
      state: "paid",
      code: "InvoicePaid",
      reason: "Paid on testnet. Try a different invoice to see what the clerk refuses. This page does not send a transaction.",
      gateBefore: RECORDED_START,
      gateAfter: RECORDED_LEFT,
      vendorAfter: RECORDED_PAYMENT,
      mark: "Recorded",
      source: PAYMENT_HASH,
    };
  }

  if (ask === "transfer") {
    return still(drawer, {
      state: "refused",
      code: "NoTokenPermission",
      reason: "The agent key can call pay and queue. It cannot call fUSD.transfer. This page does not send it. The chain already refused that call.",
      mark: "Already tested",
      source: TRANSFER_HASH,
    });
  }

  if (amount <= 0n) {
    return still(drawer, {
      state: "refused",
      code: "ZeroAmount",
      reason: "An invoice for nothing is not a payment.",
      mark: "Example",
      source: "test_pay_refusesZero",
    });
  }

  if (payee !== "vendor") {
    return still(drawer, {
      state: "refused",
      code: "WrongPayee",
      reason: "The payee is not the payout the owner registered for this vendor. This page does not send it. The chain already refused that invoice.",
      mark: "Already tested",
      source: INJECT_HASH,
    });
  }

  if (sameInvoice) {
    return still(drawer, {
      state: "refused",
      code: "InvoiceUsed",
      reason: "That invoice id is already paid. A second signature does not pay it again. This page does not send it. The chain already refused the replay.",
      mark: "Already tested",
      source: REPLAY_HASH,
    });
  }

  if (stamp === "forged") {
    return still(drawer, {
      state: "refused",
      code: "BadSignature",
      reason: "The stamp is not the vendor’s ML-DSA key. The gate does not move. This page does not send it. The chain already refused that stamp.",
      mark: "Already tested",
      source: FORGED_HASH,
    });
  }

  if (ask === "queue" && amount > PER_INVOICE_CAP) {
    return still(drawer, {
      state: "queued",
      code: "InvoiceQueued",
      reason: "Queued for the owner, and no fUSD moves. A 25,000 invoice was queued this way, then the owner approved it with ML-DSA.",
      mark: "Already tested",
      source: QUEUE_HASH,
    });
  }

  if (ask === "queue") {
    return still(drawer, {
      state: "queued",
      code: "InvoiceQueued",
      reason: "Queued for the owner. Queue does not move fUSD, and it does not look at the cap.",
      mark: "Example",
      source: "PayGate.queue",
    });
  }

  if (amount > PER_INVOICE_CAP) {
    return still(drawer, {
      state: "refused",
      code: "OverInvoiceCap",
      reason: "Pay refuses anything over the vendor’s per-invoice cap. Queue would hold it for the owner instead.",
      mark: "Example",
      source: "test_pay_refusesOverThePerInvoiceCap",
    });
  }

  if (amount > drawer) {
    return still(drawer, {
      state: "refused",
      code: "InsufficientFunds",
      reason: "The gate does not hold enough fUSD to pay this.",
      mark: "Example",
      source: "test_transfer_refusesWithoutFunds",
    });
  }

  return {
    state: "paid",
    code: "InvoicePaid",
    reason: "Within the cap and the balance. This is an example. The page does not send it.",
    gateBefore: drawer,
    gateAfter: drawer - amount,
    vendorAfter: RECORDED_PAYMENT + amount,
    mark: "Example",
    source: "PayGate.pay",
  };
}
