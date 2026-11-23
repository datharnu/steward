import { type Address, type Hex } from "viem";
import { type MandatePayload } from "./mandate.js";

export type PlannerAction = "pay" | "queue" | "skip" | "flag";

export type DecisionCode =
  | "OK_PAY"
  | "OK_QUEUE"
  | "OK_SKIP"
  | "FLAG_PLANNER"
  | "REFUSED_AGENT_PAUSED"
  | "REFUSED_GATE_PAUSED"
  | "REFUSED_INVALID_VENDOR_SIG"
  | "REFUSED_WRONG_TOKEN"
  | "REFUSED_ZERO_AMOUNT"
  | "REFUSED_UNKNOWN_VENDOR"
  | "REFUSED_VENDOR_NOT_IN_MANDATE"
  | "REFUSED_PAYEE_MISMATCH"
  | "REFUSED_ALREADY_USED"
  | "REFUSED_MANDATE_EXPIRED"
  | "REFUSED_PAST_DUE"
  | "REFUSED_TOO_EARLY_FOR_DUE_POLICY"
  | "REFUSED_MANDATE_BUDGET"
  | "REFUSED_MANDATE_PER_INVOICE"
  | "REFUSED_OVER_DAILY_CAP"
  | "REFUSED_INSUFFICIENT_GATE_BALANCE";

export type InvoiceRecord = {
  vendor: Address;
  payee: Address;
  token: Address;
  amount: string;
  invoiceId: Hex;
  dueDate: number;
  memoHash: Hex;
  memoText?: string;
  emailSubject?: string;
  emailBody?: string;
  vendorSig: Hex;
};

export type GateVendorState = {
  active: boolean;
  payout: Address;
  perInvoiceCap: bigint;
  epoch: bigint;
};

export type GateSnapshot = {
  gateAddress: Address;
  tokenAddress: Address;
  paused: boolean;
  dailyCap: bigint;
  spentToday: bigint;
  gateBalance: bigint;
  vendor: GateVendorState;
  /** 0 = None, 1 = Queued, 2 = Paid */
  invoiceState: 0 | 1 | 2;
};

export type PlannerProposal = {
  action: PlannerAction;
  reason: string;
  /** Captured for auditability if an injected email tricks the model into naming another payee. */
  requestedPayee?: string;
  /**
   * Which planner produced this proposal, e.g. `llm:anthropic:claude-opus-5-5` or `rule-based`.
   * A Claude planner that fell back to the rules says so here. The policy never reads it.
   */
  planner?: string;
};

export type ClampedDecision = {
  action: PlannerAction;
  code: DecisionCode;
  reason: string;
  willExecuteOnChain: boolean;
};

export function clampDecision(args: {
  invoice: InvoiceRecord;
  vendorSigValid: boolean;
  mandate: MandatePayload;
  mandateBudgetSpent: bigint;
  gate: GateSnapshot;
  agentLocallyPaused: boolean;
  proposal: PlannerProposal;
  nowUnix: number;
}): ClampedDecision {
  const { invoice, vendorSigValid, mandate, mandateBudgetSpent, gate, agentLocallyPaused, proposal, nowUnix } = args;
  const amount = BigInt(invoice.amount);

  if (agentLocallyPaused) {
    return {
      action: "skip",
      code: "REFUSED_AGENT_PAUSED",
      reason: "agent is paused by owner SIWQ",
      willExecuteOnChain: false,
    };
  }
  if (gate.paused) {
    return {
      action: "skip",
      code: "REFUSED_GATE_PAUSED",
      reason: "PayGate is paused on chain",
      willExecuteOnChain: false,
    };
  }
  if (!vendorSigValid) {
    return {
      action: "flag",
      code: "REFUSED_INVALID_VENDOR_SIG",
      reason: "off-chain ML-DSA-87 vendor signature failed against pqcKeyStatus",
      willExecuteOnChain: false,
    };
  }
  if (invoice.token.toLowerCase() !== gate.tokenAddress.toLowerCase()) {
    return {
      action: "flag",
      code: "REFUSED_WRONG_TOKEN",
      reason: `invoice token ${invoice.token} != gate token ${gate.tokenAddress}`,
      willExecuteOnChain: false,
    };
  }
  if (amount <= 0n) {
    return {
      action: "flag",
      code: "REFUSED_ZERO_AMOUNT",
      reason: "invoice amount must be positive",
      willExecuteOnChain: false,
    };
  }
  if (gate.invoiceState !== 0) {
    return {
      action: "skip",
      code: "REFUSED_ALREADY_USED",
      reason: `invoice already ${gate.invoiceState === 1 ? "queued" : "paid"} on PayGate`,
      willExecuteOnChain: false,
    };
  }
  if (!gate.vendor.active) {
    return {
      action: "flag",
      code: "REFUSED_UNKNOWN_VENDOR",
      reason: `vendor ${invoice.vendor} is not active on PayGate`,
      willExecuteOnChain: false,
    };
  }
  if (invoice.payee.toLowerCase() !== gate.vendor.payout.toLowerCase()) {
    return {
      action: "flag",
      code: "REFUSED_PAYEE_MISMATCH",
      reason: `invoice payee ${invoice.payee} != registered payout ${gate.vendor.payout}`,
      willExecuteOnChain: false,
    };
  }
  const vendorAllowed = mandate.allowedVendors.some((v) => v.toLowerCase() === invoice.vendor.toLowerCase());
  if (!vendorAllowed) {
    return {
      action: "flag",
      code: "REFUSED_VENDOR_NOT_IN_MANDATE",
      reason: `vendor ${invoice.vendor} is not in owner mandate`,
      willExecuteOnChain: false,
    };
  }
  if (nowUnix > mandate.expiresAt) {
    return {
      action: "skip",
      code: "REFUSED_MANDATE_EXPIRED",
      reason: "owner mandate expired",
      willExecuteOnChain: false,
    };
  }
  if (!mandate.allowPastDue && nowUnix > invoice.dueDate) {
    return {
      action: "flag",
      code: "REFUSED_PAST_DUE",
      reason: `invoice dueDate ${invoice.dueDate} has passed`,
      willExecuteOnChain: false,
    };
  }
  if (mandate.payBeforeDueHours > 0) {
    const earliestPay = invoice.dueDate - mandate.payBeforeDueHours * 3600;
    if (nowUnix < earliestPay) {
      return {
        action: "skip",
        code: "REFUSED_TOO_EARLY_FOR_DUE_POLICY",
        reason: `too early under pay-before-due policy (${mandate.payBeforeDueHours}h window)`,
        willExecuteOnChain: false,
      };
    }
  }

  // If the planner explicitly skipped or flagged an otherwise valid invoice, respect caution.
  if (proposal.action === "skip") {
    return { action: "skip", code: "OK_SKIP", reason: proposal.reason, willExecuteOnChain: false };
  }
  if (proposal.action === "flag") {
    return { action: "flag", code: "FLAG_PLANNER", reason: proposal.reason, willExecuteOnChain: false };
  }

  // If the planner suggested a different payee (e.g. prompt injection), refuse to pay directly.
  if (proposal.requestedPayee && proposal.requestedPayee.toLowerCase() !== gate.vendor.payout.toLowerCase()) {
    return {
      action: "flag",
      code: "REFUSED_PAYEE_MISMATCH",
      reason: `planner requested payee ${proposal.requestedPayee} != registered payout ${gate.vendor.payout}`,
      willExecuteOnChain: false,
    };
  }

  const budgetTotal = BigInt(mandate.budgetTotal);
  const mandateMaxPerInvoice = BigInt(mandate.maxPerInvoice);

  // Over per-invoice cap (PayGate or mandate) or over daily cap -> queue for owner approval!
  const overVendorCap = amount > gate.vendor.perInvoiceCap;
  const overMandatePerInvoice = amount > mandateMaxPerInvoice;
  const overDailyCap = gate.spentToday + amount > gate.dailyCap;
  const overMandateBudget = mandateBudgetSpent + amount > budgetTotal;

  if (proposal.action === "queue" || overVendorCap || overMandatePerInvoice || overDailyCap || overMandateBudget) {
    const reasons: string[] = [];
    if (overVendorCap) reasons.push("over vendor per-invoice cap");
    if (overMandatePerInvoice) reasons.push("over mandate per-invoice limit");
    if (overDailyCap) reasons.push("over PayGate daily cap");
    if (overMandateBudget) reasons.push("over mandate total budget");
    if (reasons.length === 0) reasons.push(proposal.reason);
    return {
      action: "queue",
      code: "OK_QUEUE",
      reason: reasons.join("; "),
      willExecuteOnChain: true,
    };
  }

  if (gate.gateBalance < amount) {
    return {
      action: "queue",
      code: "REFUSED_INSUFFICIENT_GATE_BALANCE",
      reason: `PayGate balance ${gate.gateBalance} < invoice amount ${amount}; queuing for owner`,
      willExecuteOnChain: true,
    };
  }

  return {
    action: "pay",
    code: "OK_PAY",
    reason: proposal.reason,
    willExecuteOnChain: true,
  };
}
