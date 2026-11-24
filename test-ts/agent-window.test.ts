import { describe, expect, it } from "vitest";
import { decodeFunctionData, toFunctionSelector, type Address, type Hex } from "viem";
import type { EvmWindow } from "@qorechain/evm/window";
import {
  AGENT_NAME,
  OTHER_TARGET,
  VALUE_PROBE_UQOR,
  asExpected,
  buildPlan,
  classifySubmission,
  emptyRecord,
  formatPlan,
  inTargetCall,
  otherTargetCall,
  preconditionFailures,
  probeCostUqor,
  probes,
  snapshotWindow,
  submitRawTransaction,
  windowSpecs,
  type PlanInput,
  type Probe,
} from "../scripts/lib/agent-window.js";
import { ERC20_ABI, PAYGATE_ABI } from "../src/ts/paygate.js";

const PAYGATE = "0xb0c44d0a628c4593314a5c3c113d27f2d1842a05" as Address;
const GAS = { gas: 40_000n, maxFeePerGas: 112_500_000_000n };
const FEE = 180_000n;

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    funder: "spike",
    payGate: PAYGATE,
    agentBalanceUqor: 0n,
    agentRegistered: false,
    agentPossessionProven: false,
    nativeFeeUqor: FEE,
    gas: GAS,
    ...overrides,
  };
}

function window(overrides: Partial<EvmWindow> = {}): EvmWindow {
  return {
    found: true,
    live: true,
    openedHeight: 100n,
    expiryHeight: 700n,
    maxTxs: 1n,
    usedTxs: 0n,
    maxValue: 20_000n,
    usedValue: 0n,
    remainingBlocks: 600n,
    remainingTxs: 1n,
    remainingValue: 20_000n,
    nativeOnly: false,
    allowedTargets: [PAYGATE],
    ...overrides,
  };
}

const byId = (id: string): Probe => {
  const found = probes(PAYGATE).find((p) => p.id === id);
  if (!found) throw new Error(id);
  return found;
};
const ctx = { height: 150n, agentBalanceUqor: 400_000n, gas: GAS };

describe("agent window plan", () => {
  it("funds, registers, opens two windows and runs five probes in order for a fresh agent", () => {
    const plan = buildPlan(input());
    expect(plan.steps.map((s) => s.id)).toEqual([
      "S0-fund",
      "S1-register",
      "S-open-W1",
      "P1-target",
      "P2-value",
      "P3-lands",
      "P4-transactions",
      "S-open-W2",
      "S-wait-W2",
      "P5-duration",
    ]);
    expect(plan.steps.filter((s) => s.signer === AGENT_NAME).every((s) => s.kind !== "fund")).toBe(true);
    expect(plan.steps[0].signer).toBe("spike");
  });

  it("sizes the funding to the worst case plus the value probe's headroom, rounded to 0.1 QOR", () => {
    const plan = buildPlan(input());
    // 3 native txs + 5 probes at 4,500 uqor max fee each
    expect(plan.agentWorstCaseUqor).toBe(3n * FEE + 5n * 4_500n);
    expect(plan.agentExpectedUqor).toBe(3n * FEE + 4_500n);
    expect(plan.fundUqor).toBe(700_000n);
    expect(plan.funderUqor).toBe(700_000n + FEE);
    // after registration and W1, the agent still holds the value probe's cost
    expect(plan.fundUqor - 2n * FEE).toBeGreaterThan(probeCostUqor({ valueUqor: VALUE_PROBE_UQOR }, GAS));
  });

  it("skips funding and registration when the agent already has QOR and a proven key", () => {
    const plan = buildPlan(input({ agentBalanceUqor: 2_000_000n, agentRegistered: true, agentPossessionProven: true }));
    expect(plan.fundUqor).toBe(0n);
    expect(plan.steps.map((s) => s.kind)).not.toContain("fund");
    expect(plan.steps.map((s) => s.kind)).not.toContain("register");
    expect(plan.agentWorstCaseUqor).toBe(2n * FEE + 5n * 4_500n);
  });

  it("refuses to plan around a key registered without proof of possession", () => {
    expect(() => buildPlan(input({ agentRegistered: true, agentPossessionProven: false }))).toThrow(/proof of possession/);
  });

  it("scopes both windows to PayGate only, one transaction, a budget under the value probe", () => {
    const { W1, W2 } = windowSpecs(PAYGATE);
    for (const w of [W1, W2]) {
      expect(w.targets).toEqual([PAYGATE]);
      expect(w.maxTxs).toBe(1);
      expect(probeCostUqor({ valueUqor: VALUE_PROBE_UQOR }, GAS)).toBeGreaterThan(w.maxValueUqor);
      // room for two zero-value calls, so the count, not the budget, ends W1
      expect(w.maxValueUqor).toBeGreaterThanOrEqual(2n * probeCostUqor({ valueUqor: 0n }, GAS));
    }
    expect(W2.blocks).toBeLessThan(W1.blocks);
  });

  it("encodes harmless view calls: PayGate.ownerNonce() and fUSD.decimals()", () => {
    expect(inTargetCall()).toBe(toFunctionSelector("function ownerNonce()"));
    expect(decodeFunctionData({ abi: PAYGATE_ABI, data: inTargetCall() }).functionName).toBe("ownerNonce");
    expect(decodeFunctionData({ abi: ERC20_ABI, data: otherTargetCall() }).functionName).toBe("decimals");
    expect(byId("P1-target").to).toBe(OTHER_TARGET);
    for (const id of ["P2-value", "P3-lands", "P4-transactions", "P5-duration"]) expect(byId(id).to).toBe(PAYGATE);
    expect(byId("P2-value").valueUqor).toBe(VALUE_PROBE_UQOR);
  });

  it("prices a probe as value plus gas x fee cap, rounded up to uqor", () => {
    expect(probeCostUqor({ valueUqor: 0n }, GAS)).toBe(4_500n);
    expect(probeCostUqor({ valueUqor: 50_000n }, GAS)).toBe(54_500n);
    expect(probeCostUqor({ valueUqor: 0n }, { gas: 1n, maxFeePerGas: 1n })).toBe(1n);
  });

  it("prints a plan with every step and the cost per account", () => {
    const text = formatPlan(buildPlan(input()), { agent: "x" });
    expect(text).toContain("P5-duration");
    expect(text).toContain("funder pays: 880000 uqor (0.880000 QOR)");
    expect(text).toContain("refusals before a block cost nothing");
  });
});

describe("probe preconditions isolate one limit each", () => {
  it("target: open window, budget left, recipient outside the list", () => {
    expect(preconditionFailures(byId("P1-target"), window(), ctx)).toEqual([]);
    expect(preconditionFailures(byId("P1-target"), window({ allowedTargets: [PAYGATE, OTHER_TARGET] }), ctx)).not.toEqual([]);
    expect(preconditionFailures(byId("P1-target"), window({ remainingTxs: 0n }), ctx)).not.toEqual([]);
  });

  it("value: in target, cost over the remaining budget, and the agent can afford it", () => {
    expect(preconditionFailures(byId("P2-value"), window(), ctx)).toEqual([]);
    expect(preconditionFailures(byId("P2-value"), window({ remainingValue: 60_000n }), ctx)).not.toEqual([]);
    expect(preconditionFailures(byId("P2-value"), window(), { ...ctx, agentBalanceUqor: 10_000n })).toContain(
      "agent balance 10000 uqor is below the probe's 54500 uqor",
    );
  });

  it("lands: in target, in budget, a transaction left", () => {
    expect(preconditionFailures(byId("P3-lands"), window(), ctx)).toEqual([]);
    expect(preconditionFailures(byId("P3-lands"), window({ remainingValue: 100n }), ctx)).not.toEqual([]);
  });

  it("transactions: count used up while budget and blocks remain", () => {
    const used = window({ usedTxs: 1n, remainingTxs: 0n, usedValue: 4_500n, remainingValue: 15_500n, live: false });
    expect(preconditionFailures(byId("P4-transactions"), used, ctx)).toEqual([]);
    expect(preconditionFailures(byId("P4-transactions"), window(), ctx)).toContain("the window still has 1 transactions");
    expect(preconditionFailures(byId("P4-transactions"), { ...used, remainingValue: 0n }, ctx)).not.toEqual([]);
    expect(preconditionFailures(byId("P4-transactions"), used, { ...ctx, height: 800n })).not.toEqual([]);
  });

  it("duration: past expiry with a transaction and budget unused", () => {
    const expired = window({ expiryHeight: 205n, remainingBlocks: 0n, live: false });
    expect(preconditionFailures(byId("P5-duration"), expired, { ...ctx, height: 207n })).toEqual([]);
    expect(preconditionFailures(byId("P5-duration"), expired, { ...ctx, height: 205n })).not.toEqual([]);
    expect(preconditionFailures(byId("P5-duration"), { ...expired, remainingTxs: 0n }, { ...ctx, height: 207n })).not.toEqual([]);
  });
});

describe("submission and outcome", () => {
  const raw = "0x02f8" as Hex;
  const fakeFetch = (body: unknown) => async (_url: string, init: { body: string }) => {
    expect(JSON.parse(init.body)).toMatchObject({ method: "eth_sendRawTransaction", params: [raw] });
    return { ok: true, status: 200, json: async () => body };
  };

  it("keeps the node's refusal text verbatim and classifies it", async () => {
    const message = "failed to broadcast transaction: EVM authorisation window exhausted for qor1…";
    const submission = await submitRawTransaction("http://rpc", raw, fakeFetch({ jsonrpc: "2.0", id: 1, error: { code: -32000, message } }));
    expect(submission).toEqual({ kind: "rpc-error", code: -32000, message });
    const result = classifySubmission(submission);
    expect(result).toEqual({ outcome: "refused-before-block", code: -32000, message, windowRejection: "exhausted" });
    expect(asExpected(byId("P4-transactions"), result)).toBe(true);
    expect(asExpected(byId("P3-lands"), result)).toBe(false);
  });

  it("treats a refusal that is not the window (e.g. insufficient funds) as unexpected", async () => {
    const submission = await submitRawTransaction(
      "http://rpc",
      raw,
      fakeFetch({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "insufficient funds for gas * price + value" } }),
    );
    const result = classifySubmission(submission);
    expect(result.outcome).toBe("refused-other");
    expect(asExpected(byId("P2-value"), result)).toBe(false);
  });

  it("returns an accepted hash and needs a successful receipt to call it landed", async () => {
    const hash = `0x${"ab".repeat(32)}` as Hex;
    const submission = await submitRawTransaction("http://rpc", raw, fakeFetch({ jsonrpc: "2.0", id: 1, result: hash }));
    expect(submission).toEqual({ kind: "accepted", hash });
    expect(asExpected(byId("P3-lands"), classifySubmission(submission, "success"))).toBe(true);
    const reverted = classifySubmission(submission, "reverted");
    expect(reverted.outcome).toBe("included-failed");
    expect(asExpected(byId("P1-target"), reverted)).toBe(false);
  });

  it("throws on a transport failure instead of recording it as a refusal", async () => {
    await expect(
      submitRawTransaction("http://rpc", raw, async () => ({ ok: false, status: 502, json: async () => ({}) })),
    ).rejects.toThrow(/HTTP 502/);
  });
});

describe("record", () => {
  it("starts incomplete on the testnet with both window specs and nothing recorded", () => {
    const specs = windowSpecs(PAYGATE);
    const record = emptyRecord({ payGate: PAYGATE, agentCosmos: "qor1x", agentEvm: "0x1", gas: GAS, windows: [specs.W1, specs.W2] });
    expect(record.network).toBe("qorechain-diana");
    expect(record.status).toBe("incomplete");
    expect(record.windows.map((w) => w.params.maxValueUqor)).toEqual(["20000", "20000"]);
    expect(record.transactions).toEqual([]);
    expect(record.noHashRefusals).toEqual([]);
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
  });

  it("serialises a window snapshot without bigints", () => {
    const snap = snapshotWindow(window());
    expect(snap.remainingValue).toBe("20000");
    expect(JSON.parse(JSON.stringify(snap)).allowedTargets).toEqual([PAYGATE]);
  });
});
