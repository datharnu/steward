/**
 * Pure pieces of `npm run demo:window` (scripts/demo-agent-window.ts): the plan, the probe
 * calldata, the preconditions that make each refusal attributable to exactly one window limit,
 * the classification of what the chain answered, and the record written to
 * deployments/agent-window.json. No keys and no network here except `submitRawTransaction`,
 * which takes an injectable fetch.
 */
import { classifyEvmWindowRejection, evmWindowCost, type EvmWindow } from "@qorechain/evm/window";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { ERC20_ABI, FUSD_ADDRESS, PAYGATE_ABI } from "../../src/ts/paygate.js";

export const AGENT_NAME = "steward-agent";
export const AGENT_EVM = "0x9C3876f2033552D5293e6efcAdFED87BfEB7E6be" as const;
export const AGENT_COSMOS = "qor1nsu8dusrx4fd22f7dm72mlkc00lt0e477k0fel";
/** The contract outside the window's target list: fUSD. The probe only calls `decimals()`. */
export const OTHER_TARGET = FUSD_ADDRESS as Address;
export const UQOR_WEI = 1_000_000_000_000n;

export type Limit = "target" | "value" | "transactions" | "duration";
export type WindowLabel = "W1" | "W2";

export type WindowSpec = {
  label: WindowLabel;
  blocks: number;
  maxTxs: number;
  maxValueUqor: bigint;
  targets: Address[];
  purpose: string;
};

export type Probe = {
  id: string;
  window: WindowLabel;
  /** The limit this probe exercises, or undefined for the in-target call that must land. */
  limit?: Limit;
  expect: "lands" | "refused";
  to: Address;
  data: Hex;
  valueUqor: bigint;
  description: string;
};

export type ProbeGas = { gas: bigint; maxFeePerGas: bigint };

export type StepKind = "fund" | "register" | "open" | "probe" | "wait";
export type Step = {
  id: string;
  kind: StepKind;
  signer: string;
  lane: "native hybrid" | "native classical" | "evm" | "none";
  description: string;
  expect: string;
  /** Upper bound the signer can pay for this step, in uqor (fee plus any value that leaves). */
  maxCostUqor: bigint;
  window?: WindowSpec;
  probe?: Probe;
};

export type PlanInput = {
  funder: string;
  payGate: Address;
  agentBalanceUqor: bigint;
  agentRegistered: boolean;
  agentPossessionProven: boolean;
  nativeFeeUqor: bigint;
  gas: ProbeGas;
  /** Extra uqor left with the agent on top of the worst case. */
  marginUqor?: bigint;
};

export type Plan = {
  windows: { W1: WindowSpec; W2: WindowSpec };
  steps: Step[];
  fundUqor: bigint;
  agentWorstCaseUqor: bigint;
  agentExpectedUqor: bigint;
  funderUqor: bigint;
};

/** `PayGate.ownerNonce()`: a view function. Sent as a transaction it executes and changes nothing. */
export function inTargetCall(): Hex {
  return encodeFunctionData({ abi: PAYGATE_ABI, functionName: "ownerNonce" });
}

/** `fUSD.decimals()`: harmless if a broken window ever admitted it. */
export function otherTargetCall(): Hex {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: "decimals" });
}

export function windowSpecs(payGate: Address): { W1: WindowSpec; W2: WindowSpec } {
  return {
    W1: {
      label: "W1",
      blocks: 600,
      maxTxs: 1,
      maxValueUqor: 20_000n,
      targets: [payGate],
      purpose: "target, value and transaction-count limits, and the in-target call that lands",
    },
    W2: {
      label: "W2",
      // Long enough to read it back as live after the open is confirmed, short enough to wait out.
      blocks: 20,
      maxTxs: 1,
      maxValueUqor: 20_000n,
      targets: [payGate],
      purpose: "duration limit: left to expire unused, then probed",
    },
  };
}

/** Value of the over-value probe: more than W1's whole budget, far less than the agent holds. */
export const VALUE_PROBE_UQOR = 50_000n;

export function probes(payGate: Address): Probe[] {
  const call = inTargetCall();
  return [
    {
      id: "P1-target",
      window: "W1",
      limit: "target",
      expect: "refused",
      to: OTHER_TARGET,
      data: otherTargetCall(),
      valueUqor: 0n,
      description: "fUSD.decimals() — a contract outside the window's target list",
    },
    {
      id: "P2-value",
      window: "W1",
      limit: "value",
      expect: "refused",
      to: payGate,
      data: call,
      valueUqor: VALUE_PROBE_UQOR,
      description: `PayGate.ownerNonce() carrying ${VALUE_PROBE_UQOR} uqor, over the window's ${windowSpecs(payGate).W1.maxValueUqor} uqor budget`,
    },
    {
      id: "P3-lands",
      window: "W1",
      expect: "lands",
      to: payGate,
      data: call,
      valueUqor: 0n,
      description: "PayGate.ownerNonce() with no value — in target, in budget, the window's one transaction",
    },
    {
      id: "P4-transactions",
      window: "W1",
      limit: "transactions",
      expect: "refused",
      to: payGate,
      data: call,
      valueUqor: 0n,
      description: "the same PayGate call again: a second transaction in a window that admits one",
    },
    {
      id: "P5-duration",
      window: "W2",
      limit: "duration",
      expect: "refused",
      to: payGate,
      data: call,
      valueUqor: 0n,
      description: "the same PayGate call after W2's blocks have passed, with its transaction and value unused",
    },
  ];
}

/** What one probe can consume of a window, in uqor: value plus gas limit x fee cap, rounded up. */
export function probeCostUqor(probe: Pick<Probe, "valueUqor">, gas: ProbeGas): bigint {
  return evmWindowCost({ value: probe.valueUqor * UQOR_WEI, gas: gas.gas, maxFeePerGas: gas.maxFeePerGas });
}

function roundUpTo(value: bigint, step: bigint): bigint {
  return ((value + step - 1n) / step) * step;
}

export function buildPlan(input: PlanInput): Plan {
  const windows = windowSpecs(input.payGate);
  const fee = input.nativeFeeUqor;
  const maxEvmFee = probeCostUqor({ valueUqor: 0n }, input.gas);
  const list = probes(input.payGate);
  const steps: Step[] = [];
  const needsKey = !input.agentRegistered;

  // Worst case the agent pays: native fees, every probe landing in a block (fee only: a
  // refused value probe moves nothing, and PayGate's view function rejects value anyway),
  // plus the value probe's value held in the balance so "insufficient funds" cannot be the
  // reason it is refused.
  const nativeTxs = BigInt((needsKey ? 1 : 0) + 2);
  const agentWorstCase = nativeTxs * fee + BigInt(list.length) * maxEvmFee;
  const agentExpected = nativeTxs * fee + maxEvmFee;
  const required = agentWorstCase + probeCostUqor(list[1], input.gas) + (input.marginUqor ?? 50_000n);
  const shortfall = required > input.agentBalanceUqor ? required - input.agentBalanceUqor : 0n;
  const fundUqor = shortfall === 0n ? 0n : roundUpTo(shortfall, 100_000n);

  if (fundUqor > 0n) {
    steps.push({
      id: "S0-fund",
      kind: "fund",
      signer: input.funder,
      lane: "native hybrid",
      description: `bank send ${fundUqor} uqor ${input.funder} -> ${AGENT_NAME} (${AGENT_COSMOS}); the agent account does not exist on chain until it holds QOR`,
      expect: "lands (code 0)",
      maxCostUqor: fundUqor + fee,
    });
  }
  if (needsKey) {
    steps.push({
      id: "S1-register",
      kind: "register",
      signer: AGENT_NAME,
      lane: "native classical",
      description: "register the agent's ML-DSA-87 key with proof of possession (MsgRegisterPQCKey, keyType hybrid); classical because no PQC key exists yet",
      expect: "lands; pqcKeyStatus then reads registered=true, algorithm 1, possessionProven=true",
      maxCostUqor: fee,
    });
  } else if (!input.agentPossessionProven) {
    throw new Error("the agent has an ML-DSA key registered without proof of possession; rotate it before this demo");
  }
  const open = (w: WindowSpec): Step => ({
    id: `S-open-${w.label}`,
    kind: "open",
    signer: AGENT_NAME,
    lane: "native hybrid",
    description: `MsgOpenEVMWindow ${w.label}: blocks=${w.blocks}, maxTxs=${w.maxTxs}, maxValue=${w.maxValueUqor} uqor, allowedTargets=[${w.targets.join(", ")}] — ${w.purpose}`,
    expect: "lands; REST evm_window reads live with these bounds",
    maxCostUqor: fee,
    window: w,
  });
  const probeStep = (p: Probe): Step => ({
    id: p.id,
    kind: "probe",
    signer: AGENT_NAME,
    lane: "evm",
    description: `${p.description} (gas ${input.gas.gas}, fee cap ${input.gas.maxFeePerGas} wei, window cost ${probeCostUqor(p, input.gas)} uqor)`,
    expect:
      p.expect === "lands"
        ? "the window admits it and it lands with a hash; PayGate executes a view function, nothing changes"
        : `the window refuses it (${p.limit} limit); expected at broadcast with no hash, chain text recorded verbatim`,
    maxCostUqor: p.expect === "lands" ? maxEvmFee : 0n,
    probe: p,
  });
  steps.push(open(windows.W1));
  for (const p of list.filter((x) => x.window === "W1")) steps.push(probeStep(p));
  steps.push(open(windows.W2));
  steps.push({
    id: "S-wait-W2",
    kind: "wait",
    signer: "-",
    lane: "none",
    description: `wait until the chain height passes W2's expiry height (${windows.W2.blocks} blocks, ~1 s each)`,
    expect: "REST evm_window reads remaining_blocks=0 with remaining_txs=1",
    maxCostUqor: 0n,
  });
  for (const p of list.filter((x) => x.window === "W2")) steps.push(probeStep(p));

  return {
    windows,
    steps,
    fundUqor,
    agentWorstCaseUqor: agentWorstCase,
    agentExpectedUqor: agentExpected,
    funderUqor: fundUqor === 0n ? 0n : fundUqor + fee,
  };
}

/**
 * The conditions under which a refusal can only be the named limit. The script will not send a
 * probe whose preconditions fail: the refusal would not prove what the record says it proves.
 */
export function preconditionFailures(
  probe: Probe,
  window: EvmWindow,
  ctx: { height: bigint; agentBalanceUqor: bigint; gas: ProbeGas },
): string[] {
  const cost = probeCostUqor(probe, ctx.gas);
  const zeroCost = probeCostUqor({ valueUqor: 0n }, ctx.gas);
  const targets = window.allowedTargets.map((t) => t.toLowerCase());
  const inTarget = targets.includes(probe.to.toLowerCase());
  const failures: string[] = [];
  const need = (ok: boolean, why: string) => {
    if (!ok) failures.push(why);
  };
  need(window.found, "no window is stored");
  need(ctx.agentBalanceUqor >= cost, `agent balance ${ctx.agentBalanceUqor} uqor is below the probe's ${cost} uqor`);
  need(targets.length > 0, "the window is not scoped to targets");
  if (probe.limit === "target" || probe.limit === "value" || probe.expect === "lands") {
    need(window.remainingTxs > 0n, "the window has no transactions left");
    need(window.remainingBlocks > 0n && ctx.height < window.expiryHeight, "the window has expired");
  }
  switch (probe.limit) {
    case "target":
      need(!inTarget, `${probe.to} is in the window's targets`);
      need(window.remainingValue >= cost, "the window's value budget would also refuse it");
      break;
    case "value":
      need(inTarget, `${probe.to} is not in the window's targets`);
      need(cost > window.remainingValue, `cost ${cost} fits the remaining ${window.remainingValue} uqor`);
      break;
    case "transactions":
      need(inTarget, `${probe.to} is not in the window's targets`);
      need(window.remainingTxs === 0n, `the window still has ${window.remainingTxs} transactions`);
      need(window.remainingValue >= zeroCost, "the window's value budget would also refuse it");
      need(window.remainingBlocks > 0n && ctx.height < window.expiryHeight, "the window has also expired");
      break;
    case "duration":
      need(inTarget, `${probe.to} is not in the window's targets`);
      need(ctx.height > window.expiryHeight, `height ${ctx.height} has not passed expiry ${window.expiryHeight}`);
      need(window.remainingTxs > 0n, "the window's transaction count would also refuse it");
      need(window.remainingValue >= zeroCost, "the window's value budget would also refuse it");
      break;
    case undefined:
      need(inTarget, `${probe.to} is not in the window's targets`);
      need(window.remainingValue >= cost, `cost ${cost} exceeds the remaining ${window.remainingValue} uqor`);
      break;
  }
  return failures;
}

export type Submission =
  | { kind: "accepted"; hash: Hex }
  | { kind: "rpc-error"; code: number | null; message: string; data?: unknown };

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/**
 * `eth_sendRawTransaction` over plain JSON-RPC, so a refusal is kept exactly as the node words it
 * (viem would wrap it). A transport failure throws; a JSON-RPC error is returned.
 */
export async function submitRawTransaction(
  rpc: string,
  serialized: Hex,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<Submission> {
  const response = await fetchImpl(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [serialized] }),
  });
  if (!response.ok) throw new Error(`eth_sendRawTransaction: HTTP ${response.status}`);
  const body = (await response.json()) as { result?: string; error?: { code?: number; message?: string; data?: unknown } };
  if (body.error) {
    return {
      kind: "rpc-error",
      code: typeof body.error.code === "number" ? body.error.code : null,
      message: body.error.message ?? JSON.stringify(body.error),
      ...(body.error.data === undefined ? {} : { data: body.error.data }),
    };
  }
  if (typeof body.result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.result)) {
    throw new Error(`eth_sendRawTransaction: unexpected answer ${JSON.stringify(body)}`);
  }
  return { kind: "accepted", hash: body.result as Hex };
}

export type ProbeOutcome =
  | { outcome: "landed"; hash: Hex; status: "success" }
  | { outcome: "refused-before-block"; code: number | null; message: string; windowRejection: string | null }
  | { outcome: "included-failed"; hash: Hex; status: "reverted" }
  | { outcome: "refused-other"; code: number | null; message: string };

export function classifySubmission(
  submission: Submission,
  receiptStatus?: "success" | "reverted",
): ProbeOutcome {
  if (submission.kind === "rpc-error") {
    const kind = classifyEvmWindowRejection(submission.message) ?? null;
    if (kind === null) return { outcome: "refused-other", code: submission.code, message: submission.message };
    return { outcome: "refused-before-block", code: submission.code, message: submission.message, windowRejection: kind };
  }
  if (receiptStatus === "success") return { outcome: "landed", hash: submission.hash, status: "success" };
  return { outcome: "included-failed", hash: submission.hash, status: "reverted" };
}

/** Whether the outcome is the one the probe exists to show. Anything else stops the run. */
export function asExpected(probe: Probe, result: ProbeOutcome): boolean {
  if (probe.expect === "lands") return result.outcome === "landed";
  return result.outcome === "refused-before-block";
}

export type Tier = "pqc" | "enrollment" | "classical" | "refused";
export type EvidenceEntry = { hash: string; tier: Tier; note: string };
export type NoHashRefusal = {
  step: string;
  limit: Limit;
  /** The hash the signed transaction would have had. Never included in a block. */
  signedHash: Hex;
  chainError: { code: number | null; message: string };
  windowRejection: string | null;
  height: string;
  note: string;
};

export type WindowSnapshot = Record<keyof EvmWindow, string | boolean | string[]>;

export function snapshotWindow(window: EvmWindow): WindowSnapshot {
  return Object.fromEntries(
    Object.entries(window).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value]),
  ) as WindowSnapshot;
}

export type AgentWindowRecord = {
  network: "qorechain-diana";
  evmChainId: number;
  recordedAt: string;
  status: "complete" | "incomplete";
  agent: { name: string; cosmos: string; evm: string };
  payGate: Address;
  otherTarget: Address;
  gas: { gas: string; maxFeePerGas: string };
  windows: {
    label: WindowLabel;
    params: { blocks: number; maxTxs: number; maxValueUqor: string; targets: string[] };
    openHash?: string;
    openHeight?: string;
    onChain?: WindowSnapshot;
  }[];
  steps: {
    id: string;
    limit?: Limit;
    expect: string;
    asExpected: boolean;
    height: string;
    hash?: string;
    signedHash?: string;
    chainError?: { code: number | null; message: string };
    windowRejection?: string | null;
    windowBefore?: WindowSnapshot;
    note: string;
  }[];
  /** Read by `npm run evidence`: every step that has a hash. */
  transactions: EvidenceEntry[];
  /** Printed by `npm run evidence`; nothing on chain to re-check. */
  noHashRefusals: NoHashRefusal[];
};

export function emptyRecord(input: { payGate: Address; agentCosmos: string; agentEvm: string; gas: ProbeGas; windows: WindowSpec[] }): AgentWindowRecord {
  return {
    network: "qorechain-diana",
    evmChainId: 9800,
    recordedAt: new Date().toISOString(),
    status: "incomplete",
    agent: { name: AGENT_NAME, cosmos: input.agentCosmos, evm: input.agentEvm },
    payGate: input.payGate,
    otherTarget: OTHER_TARGET,
    gas: { gas: input.gas.gas.toString(), maxFeePerGas: input.gas.maxFeePerGas.toString() },
    windows: input.windows.map((w) => ({
      label: w.label,
      params: { blocks: w.blocks, maxTxs: w.maxTxs, maxValueUqor: w.maxValueUqor.toString(), targets: [...w.targets] },
    })),
    steps: [],
    transactions: [],
    noHashRefusals: [],
  };
}

export function formatUqor(uqor: bigint): string {
  const whole = uqor / 1_000_000n;
  const frac = (uqor % 1_000_000n).toString().padStart(6, "0");
  return `${uqor} uqor (${whole}.${frac} QOR)`;
}

export function formatPlan(plan: Plan, state: Record<string, string>): string {
  const lines: string[] = [];
  lines.push("STATE (read-only)");
  for (const [key, value] of Object.entries(state)) lines.push(`  ${key}: ${value}`);
  lines.push("", "PLAN");
  plan.steps.forEach((step, i) => {
    lines.push(`  ${String(i + 1).padStart(2)}. [${step.id}] ${step.signer} / ${step.lane}`);
    lines.push(`      ${step.description}`);
    lines.push(`      expect: ${step.expect}`);
    lines.push(`      max cost: ${formatUqor(step.maxCostUqor)}`);
  });
  lines.push("", "COST");
  if (plan.fundUqor > 0n) lines.push(`  funder pays: ${formatUqor(plan.funderUqor)} (transfer + fee)`);
  lines.push(`  agent expected spend: ${formatUqor(plan.agentExpectedUqor)} (refusals before a block cost nothing)`);
  lines.push(`  agent worst case: ${formatUqor(plan.agentWorstCaseUqor)} (every probe landing in a block)`);
  return lines.join("\n");
}
