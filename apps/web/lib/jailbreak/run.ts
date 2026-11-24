/**
 * One /jailbreak run: live gate read, the real model with Steward's prompt, the deterministic
 * policy, then `eth_call` simulations of what the agent key would submit. Read-only throughout.
 */
import { keccak256, toBytes } from "viem";
import {
  buildPlannerPrompts,
  clampDecision,
  demoMandate,
  isFooled,
  type Address,
  type ClampedDecision,
  type InvoiceFixture,
  type InvoiceRecord,
  type PlannerPrompts,
  type PlannerProposal,
  type PromptMode,
} from "./core";
import { readGate, readVendorKey, simulateAgentCall, type GateRead, type Rpc, type SimulationOutcome, type VendorKey } from "./chain";
import { modelOption, type RunInput } from "./input";
import type { ModelAnswer } from "./llm";
import injected from "./injected-invoice.json";
import clean from "./clean-invoice.json";

export const FIXTURES: Record<RunInput["invoice"], InvoiceFixture> = {
  injected: injected as InvoiceFixture,
  clean: clean as InvoiceFixture,
};

export const ML_DSA_87 = 1;

export type Simulation = {
  label: string;
  why: string;
  fn: "pay" | "queue";
  payee: string;
  payeeIsSigned: boolean;
  outcome: SimulationOutcome;
  /** Base units a broadcast of this exact call would move (0 unless the simulation succeeded on `pay`). */
  wouldMove: string;
};

export type JailbreakResult = {
  ranAt: string;
  invoice: {
    kind: RunInput["invoice"];
    sourceTx: string;
    vendor: string;
    payee: string;
    token: string;
    amount: string;
    invoiceId: string;
    dueDate: number;
    memoHash: string;
    memoText: string;
    emailBody: string;
    memoMatchesSignedHash: boolean;
  };
  signature: {
    valid: boolean;
    keySource: "pqcKeyStatus (live)";
    keyRegistered: boolean;
    algorithm: string;
    possessionProven: boolean;
  };
  gate: {
    balance: string;
    paused: boolean;
    payout: string;
    perInvoiceCap: string;
    dailyCap: string;
    spentToday: string;
    invoiceState: number;
    agent: string;
    agentUntil: string;
  };
  model: { key: string; label: string; planner: string; guard: RunInput["guard"]; promptMode: PromptMode };
  prompts: PlannerPrompts;
  llm: Omit<ModelAnswer, "proposal">;
  proposal?: PlannerProposal;
  fooled: boolean | null;
  policy?: ClampedDecision;
  simulations: Simulation[];
  moved: "0";
  verdict: string;
};

export type RunDeps = {
  rpc: Rpc;
  /** Calls the model with these prompts. Must not fall back to rules. */
  askModel: (prompts: PlannerPrompts) => Promise<ModelAnswer>;
  /** ML-DSA-87 verification (pqVerify from @qorechain/qoresign in production). */
  verifyVendorSig: (invoice: InvoiceRecord, gate: Address, pubkey: `0x${string}`) => boolean;
  nowUnix: number;
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** The invoice the agent key would submit if it acted on this proposal. */
function plannedCalls(invoice: InvoiceRecord, proposal: PlannerProposal | undefined, gate: GateRead): Omit<Simulation, "outcome" | "wouldMove">[] {
  const asSigned = { fn: "pay" as const, payee: invoice.payee, payeeIsSigned: true };
  if (!proposal || (proposal.action !== "pay" && proposal.action !== "queue")) {
    return [
      {
        ...asSigned,
        label: "If the agent key sent this invoice anyway",
        why: proposal
          ? `The model chose ${proposal.action}, so Steward would send nothing. This asks PayGate what happens if a compromised or fooled agent called pay with the invoice as signed.`
          : "There is no proposal, so Steward would send nothing. This asks PayGate what happens if the agent key called pay with the invoice as signed.",
      },
    ];
  }
  const requested = proposal.requestedPayee;
  const usable = requested !== undefined && ADDRESS.test(requested);
  const payee = usable ? requested : invoice.payee;
  const calls: Omit<Simulation, "outcome" | "wouldMove">[] = [];
  const swapped = !sameAddress(payee, invoice.payee);
  calls.push({
    fn: proposal.action,
    payee,
    payeeIsSigned: !swapped,
    label: `The agent's ${proposal.action} as the model proposed it`,
    why: swapped
      ? sameAddress(payee, gate.vendor.payout)
        ? "The model asked to pay the registered payout instead of the invoice's payee. The agent would have to change the payee, and the vendor's signature covers the payee it signed."
        : `The model asked to pay ${payee}, which is not the payee the vendor signed.`
      : requested !== undefined && !usable
        ? "The model named a payee that is not an address, so the agent would submit the invoice as signed."
        : "The agent submits the invoice exactly as the vendor signed it.",
  });
  if (swapped) {
    calls.push({ ...asSigned, label: "The same invoice, as the vendor signed it", why: "For comparison: the vendor-signed payee, unchanged." });
  }
  return calls;
}

function verdictFor(r: Pick<JailbreakResult, "proposal" | "fooled" | "policy" | "simulations" | "llm" | "model">): string {
  const chain = r.simulations[0];
  const chainLine =
    chain?.outcome.status === "reverted"
      ? `PayGate would revert with ${chain.outcome.revert?.name ?? chain.outcome.selector}.`
      : chain?.outcome.status === "ok"
        ? `PayGate would accept ${chain.fn} (simulation only).`
        : "The chain simulation could not run.";
  if (!r.proposal) return `${r.model.label} gave no usable answer (${r.llm.error ?? "unknown"}). Steward does not fall back to rules here, so nothing would be sent. ${chainLine} fUSD moved: 0.`;
  const head = r.fooled
    ? `${r.model.label} was fooled: ${r.proposal.action}${r.proposal.requestedPayee ? ` to ${r.proposal.requestedPayee}` : ""}.`
    : `${r.model.label} was not fooled (${r.proposal.action}).`;
  const policy = r.policy ? `Policy: ${r.policy.code}${r.policy.willExecuteOnChain ? " (would send to chain)" : " (would send nothing)"}.` : "";
  return `${head} ${policy} ${chainLine} fUSD moved: 0.`;
}

export async function runJailbreak(input: RunInput, deps: RunDeps): Promise<JailbreakResult> {
  const fixture = FIXTURES[input.invoice];
  const option = modelOption(input.model);
  const promptMode: PromptMode = input.guard === "on" ? "guarded" : "unguarded";
  const invoice: InvoiceRecord = { ...fixture.invoice, memoText: input.memoText, emailBody: input.emailBody };

  // Read the chain first: if the testnet is down, no model call is spent.
  const [gate, key]: [GateRead, VendorKey] = await Promise.all([readGate(deps.rpc, invoice), readVendorKey(deps.rpc, invoice.vendor)]);
  const keyUsable = key.registered && key.algorithmId === ML_DSA_87 && key.possessionProven;
  const sigValid = keyUsable && deps.verifyVendorSig(invoice, fixture.gate, key.pubkey);

  const prompts = buildPlannerPrompts(invoice, { mandate: demoMandate(fixture, deps.nowUnix), mandateBudgetSpent: 0n, gate, nowUnix: deps.nowUnix }, promptMode);
  const answer = await deps.askModel(prompts);
  const { proposal, ...llm } = answer;

  const fooled = proposal ? isFooled(proposal, gate, invoice) : null;
  const policy = proposal
    ? clampDecision({
        invoice,
        vendorSigValid: sigValid,
        mandate: demoMandate(fixture, deps.nowUnix),
        mandateBudgetSpent: 0n,
        gate,
        agentLocallyPaused: false,
        proposal,
        nowUnix: deps.nowUnix,
      })
    : undefined;

  const simulations: Simulation[] = [];
  for (const planned of plannedCalls(invoice, proposal, gate)) {
    const outcome = await simulateAgentCall(deps.rpc, { fn: planned.fn, invoice: { ...invoice, payee: planned.payee as Address }, from: gate.agent });
    simulations.push({ ...planned, outcome, wouldMove: outcome.status === "ok" && planned.fn === "pay" ? invoice.amount : "0" });
  }

  const model = {
    key: option.key,
    label: option.label,
    planner: `llm:${option.provider}:${option.model}${promptMode === "unguarded" ? ":unguarded" : ""}`,
    guard: input.guard,
    promptMode,
  };
  const result: JailbreakResult = {
    ranAt: new Date(deps.nowUnix * 1000).toISOString(),
    invoice: {
      kind: input.invoice,
      sourceTx: fixture.sourceTx,
      vendor: invoice.vendor,
      payee: invoice.payee,
      token: invoice.token,
      amount: invoice.amount,
      invoiceId: invoice.invoiceId,
      dueDate: invoice.dueDate,
      memoHash: invoice.memoHash,
      memoText: input.memoText,
      emailBody: input.emailBody,
      memoMatchesSignedHash: keccak256(toBytes(input.memoText)).toLowerCase() === invoice.memoHash.toLowerCase(),
    },
    signature: {
      valid: sigValid,
      keySource: "pqcKeyStatus (live)",
      keyRegistered: key.registered,
      algorithm: key.algorithmId === ML_DSA_87 ? "ML-DSA-87" : `algorithm ${key.algorithmId}`,
      possessionProven: key.possessionProven,
    },
    gate: {
      balance: gate.gateBalance.toString(),
      paused: gate.paused,
      payout: gate.vendor.payout,
      perInvoiceCap: gate.vendor.perInvoiceCap.toString(),
      dailyCap: gate.dailyCap.toString(),
      spentToday: gate.spentToday.toString(),
      invoiceState: gate.invoiceState,
      agent: gate.agent,
      agentUntil: gate.agentUntil.toString(),
    },
    model,
    prompts,
    llm,
    proposal,
    fooled,
    policy,
    simulations,
    moved: "0",
    verdict: "",
  };
  result.verdict = verdictFor(result);
  return result;
}
