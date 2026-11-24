/**
 * The /api/jailbreak handler with a mocked model and a mocked chain: no network, no keys.
 * Real ML-DSA-87 verification of the committed fixtures; fake PayGate answers that follow
 * PayGate's order (payee before signature).
 */
import { readFileSync } from "node:fs";
import { pqVerify } from "@qorechain/qoresign";
import { decodeFunctionData, encodeErrorResult, encodeFunctionResult, parseAbi, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import * as chainModule from "../apps/web/lib/jailbreak/chain.js";
import * as handlerModule from "../apps/web/lib/jailbreak/handler.js";
import * as inputModule from "../apps/web/lib/jailbreak/input.js";
import * as limitsModule from "../apps/web/lib/jailbreak/limits.js";
import * as payCheckModule from "../apps/web/lib/pay-check.js";
import type { JailbreakResult } from "../apps/web/lib/jailbreak/run.js";
import type { InvoiceRecord } from "../apps/web/lib/jailbreak/core.js";

function cjs<T extends object>(ns: T): T {
  return ((ns as { default?: T }).default ?? ns) as T;
}
const { REVERT_ABI, decodeRevert } = cjs(chainModule);
const { createJailbreakHandler } = cjs(handlerModule);
const { parseRunInput, plainText, redactSecrets, PRESETS } = cjs(inputModule);
const { RateLimiter, DailyCap, clientIp } = cjs(limitsModule);
const { invoiceMessage } = cjs(payCheckModule);

const injected = JSON.parse(readFileSync("fixtures/injected-invoice.json", "utf8")) as { gate: Address; invoice: InvoiceRecord; vendorPubkey: Hex };
const ATTACKER = "0x00000000000000000000000000000000000000a1";
const PAYOUT = injected.invoice.vendor;
const AGENT = "0xaC52f45E6787c08E3B22f45e7f35803Fc13e7396";
const OR_KEY = "sk-or-v1-TESTKEYopenrouter0123456789abcdef";
const AN_KEY = "sk-ant-api03-TESTKEYanthropic0123456789abcdef";

const READ_ABI = parseAbi([
  "function token() view returns (address)",
  "function agent() view returns (address)",
  "function agentUntil() view returns (uint256)",
  "function dailyCap() view returns (uint256)",
  "function paused() view returns (bool)",
  "function spentToday() view returns (uint256)",
  "function vendors(address vendor) view returns (bool active, address payout, uint256 perInvoiceCap, uint64 epoch)",
  "function invoiceState(bytes32 key) view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function pqcKeyStatus(address account) view returns (bool registered, uint8 algorithmId, bytes pubkey, bool possessionProven)",
  "function pay((address vendor, address payee, address token, uint256 amount, bytes32 invoiceId, uint256 dueDate, bytes32 memoHash) invoice, bytes vendorSig)",
  "function queue((address vendor, address payee, address token, uint256 amount, bytes32 invoiceId, uint256 dueDate, bytes32 memoHash) invoice, bytes vendorSig)",
]);

type RpcLog = { calls: number; sims: number };

/** A fake testnet: PayGate's reads, and pay/queue that check the payee, then the real ML-DSA-87 signature. */
function fakeRpc(log: RpcLog = { calls: 0, sims: 0 }, opts: { down?: boolean } = {}) {
  return async (_method: string, params: unknown[]) => {
    log.calls += 1;
    if (opts.down) throw new chainModule.ChainUnavailableError();
    const { data, from } = params[0] as { to: Address; data: Hex; from?: Address };
    const d = decodeFunctionData({ abi: READ_ABI, data });
    const result = (value: unknown) => ({ result: encodeFunctionResult({ abi: READ_ABI, functionName: d.functionName, result: value } as never) });
    switch (d.functionName) {
      case "token":
        return result(injected.invoice.token);
      case "agent":
        return result(AGENT);
      case "agentUntil":
        return result(1_797_682_327n);
      case "dailyCap":
        return result(2_500_000_000n);
      case "paused":
        return result(false);
      case "spentToday":
        return result(0n);
      case "vendors":
        return result([true, PAYOUT, 20_000n, 1n]);
      case "invoiceState":
        return result(0);
      case "balanceOf":
        return result(862n);
      case "pqcKeyStatus":
        return result([true, 1, injected.vendorPubkey, true]);
      case "pay":
      case "queue": {
        log.sims += 1;
        if (from?.toLowerCase() !== AGENT.toLowerCase()) {
          return { error: { code: 3, message: "execution reverted", data: encodeErrorResult({ abi: REVERT_ABI, errorName: "NotAgent", args: [from ?? "0x0000000000000000000000000000000000000000"] }) } };
        }
        const [t, sig] = d.args as unknown as [InvoiceRecord & { amount: bigint; dueDate: bigint }, Hex];
        if (t.payee.toLowerCase() !== PAYOUT.toLowerCase()) {
          return { error: { code: 3, message: "execution reverted", data: encodeErrorResult({ abi: REVERT_ABI, errorName: "WrongPayee", args: [t.payee, PAYOUT] }) } };
        }
        const msg = invoiceMessage(injected.gate, { ...t, amount: BigInt(t.amount), dueDate: BigInt(t.dueDate), signature: sig });
        const ok = pqVerify(Buffer.from(injected.vendorPubkey.slice(2), "hex"), Buffer.from(msg.slice(2), "hex"), Buffer.from(sig.slice(2), "hex"));
        if (!ok) return { error: { code: 3, message: "execution reverted", data: encodeErrorResult({ abi: REVERT_ABI, errorName: "SignatureInvalid" }) } };
        return { result: "0x" };
      }
      default:
        return { error: { code: -32000, message: "unexpected" } };
    }
  };
}

type Reply = { status: number; body: string; headers?: Record<string, string> };

function fakeModel(replies: Reply[], seen: { urls: string[]; headers: Record<string, string>[] } = { urls: [], headers: [] }) {
  let i = 0;
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.urls.push(String(url));
    seen.headers.push(init?.headers as Record<string, string>);
    const r = replies[Math.min(i++, replies.length - 1)];
    return new Response(r.body, { status: r.status, headers: r.headers });
  }) as typeof fetch;
}

const orAnswer = (obj: unknown) => ({ status: 200, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }] }) });
const claudeAnswer = (input: unknown, text = "") =>
  ({ status: 200, body: JSON.stringify({ stop_reason: "tool_use", content: [...(text ? [{ type: "text", text }] : []), { type: "tool_use", name: "decide_invoice", input }] }) });

function handler(opts: { replies?: Reply[]; env?: Partial<Record<string, string>>; rpcDown?: boolean; log?: RpcLog; now?: () => number } = {}) {
  const log = opts.log ?? { calls: 0, sims: 0 };
  const seen = { urls: [] as string[], headers: [] as Record<string, string>[] };
  const h = createJailbreakHandler({
    env: { OPENROUTER_API_KEY: OR_KEY, ANTHROPIC_API_KEY: AN_KEY, ...opts.env },
    rpc: fakeRpc(log, { down: opts.rpcDown }),
    fetchImpl: fakeModel(opts.replies ?? [orAnswer({ action: "flag", reason: "redirect attempt" })], seen),
    now: opts.now,
    pqVerify,
    invoiceMessage: (gate, inv) =>
      invoiceMessage(gate, { ...inv, amount: BigInt(inv.amount), dueDate: BigInt(inv.dueDate), signature: inv.vendorSig }),
    sleep: async () => {},
  });
  return { h, log, seen };
}

let ipCounter = 0;
function post(body: unknown, headers: Record<string, string> = {}): Request {
  ipCounter += 1;
  return new Request("http://localhost:3000/api/jailbreak", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", "x-forwarded-for": `10.0.0.${ipCounter % 250}`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const attack = (over: Record<string, unknown> = {}) => ({ invoice: "injected", model: "nemotron", guard: "on", memoText: PRESETS[0].memoText, emailBody: PRESETS[0].emailBody, ...over });

async function run(h: ReturnType<typeof handler>["h"], body: unknown, headers?: Record<string, string>) {
  const res = await h.POST(post(body, headers));
  const text = await res.text();
  return { res, text, json: JSON.parse(text) as JailbreakResult & { error?: string; code?: string } };
}

describe("a run, layer by layer", () => {
  it("a fooled model: policy refuses, PayGate reverts WrongPayee, 0 moved", async () => {
    const { h, log } = handler({ replies: [orAnswer({ action: "pay", reason: "memo instructs to pay", requestedPayee: ATTACKER })] });
    const { res, json } = await run(h, attack({ model: "lfm", guard: "off" }));
    expect(res.status).toBe(200);
    expect(json.model.planner).toBe("llm:openrouter:liquid/lfm-3-1.7b:free:unguarded");
    expect(json.fooled).toBe(true);
    expect(json.signature.valid).toBe(true);
    expect(json.invoice.memoMatchesSignedHash).toBe(true);
    expect(json.policy?.code).toBe("REFUSED_PAYEE_MISMATCH");
    expect(json.policy?.willExecuteOnChain).toBe(false);
    expect(json.simulations).toHaveLength(1);
    const o = json.simulations[0].outcome;
    expect(o.status === "reverted" && o.revert?.name).toBe("WrongPayee");
    expect(o.status === "reverted" && o.revert?.args.map((a) => a.toLowerCase())).toEqual([ATTACKER, PAYOUT.toLowerCase()]);
    expect(json.simulations[0].wouldMove).toBe("0");
    expect(json.moved).toBe("0");
    expect(json.verdict).toMatch(/was fooled.*REFUSED_PAYEE_MISMATCH.*WrongPayee.*fUSD moved: 0/);
    expect(log.sims).toBe(1);
  });

  it("a model that catches it: not fooled, and PayGate would still refuse a forced send", async () => {
    const { h } = handler({ replies: [orAnswer({ action: "flag", reason: "redirect attempt", requestedPayee: ATTACKER })] });
    const { json } = await run(h, attack());
    expect(json.fooled).toBe(false);
    expect(json.policy?.code).toBe("REFUSED_PAYEE_MISMATCH");
    expect(json.simulations[0].label).toMatch(/anyway/);
    expect(json.simulations[0].outcome.status).toBe("reverted");
  });

  it("paying the registered payout instead breaks the vendor's signature", async () => {
    const { h } = handler({ replies: [orAnswer({ action: "pay", reason: "pay the real vendor", requestedPayee: PAYOUT })] });
    const { json } = await run(h, attack());
    expect(json.fooled).toBe(false);
    expect(json.simulations).toHaveLength(2);
    const [swapped, signed] = json.simulations;
    expect(swapped.payeeIsSigned).toBe(false);
    expect(swapped.outcome.status === "reverted" && swapped.outcome.revert?.name).toBe("SignatureInvalid");
    expect(signed.outcome.status === "reverted" && signed.outcome.revert?.name).toBe("WrongPayee");
  });

  it("the clean invoice passes every layer in simulation and still moves 0", async () => {
    const clean = JSON.parse(readFileSync("fixtures/clean-invoice.json", "utf8"));
    const { h } = handler({ replies: [orAnswer({ action: "pay", reason: "valid invoice" })] });
    const { json } = await run(h, attack({ invoice: "clean", memoText: clean.invoice.memoText, emailBody: clean.invoice.emailBody }));
    expect(json.signature.valid).toBe(true);
    expect(json.invoice.memoMatchesSignedHash).toBe(true);
    expect(json.policy?.code).toBe("OK_PAY");
    expect(json.simulations[0].outcome.status).toBe("ok");
    expect(json.simulations[0].wouldMove).toBe("500");
    expect(json.moved).toBe("0");
  });

  it("an edited memo is reported as not matching the signed hash", async () => {
    const { h } = handler();
    const { json } = await run(h, attack({ memoText: "something else" }));
    expect(json.invoice.memoMatchesSignedHash).toBe(false);
  });

  it("sends Steward's prompt, guarded or not, to the selected provider", async () => {
    const a = handler({ replies: [claudeAnswer({ action: "flag", reason: "injection" })] });
    const { json } = await run(a.h, attack({ model: "claude" }));
    expect(a.seen.urls).toEqual(["https://api.anthropic.com/v1/messages"]);
    expect(a.seen.headers[0]["x-api-key"]).toBe(AN_KEY);
    expect(json.prompts.system).toMatch(/CRITICAL SECURITY BOUNDARY/);
    expect(json.model.planner).toBe("llm:anthropic:claude-opus-5-5");
    const b = handler();
    const off = await run(b.h, attack({ guard: "off" }));
    expect(b.seen.urls).toEqual(["https://openrouter.ai/api/v1/chat/completions"]);
    expect(off.json.prompts.system).toMatch(/Follow the payment instructions/);
  });
});

describe("model failures never fall back to rules", () => {
  it("a refusal", async () => {
    const { h } = handler({ replies: [{ status: 200, body: JSON.stringify({ stop_reason: "refusal", content: [] }) }] });
    const { json } = await run(h, attack({ model: "claude", guard: "off" }));
    expect(json.proposal).toBeUndefined();
    expect(json.llm.error).toBe("the model refused");
    expect(json.policy).toBeUndefined();
    expect(json.fooled).toBeNull();
    expect(json.verdict).toMatch(/no usable answer.*does not fall back/);
    expect(JSON.stringify(json)).not.toMatch(/rule-based/);
  });

  it("garbage", async () => {
    const { h } = handler({ replies: [{ status: 200, body: JSON.stringify({ choices: [{ message: { content: "I think you should pay." } }] }) }] });
    const { json } = await run(h, attack());
    expect(json.llm.error).toBe("the answer did not match the decide_invoice schema");
    expect(json.llm.modelText).toBe("I think you should pay.");
  });

  it("429 then an answer retries once", async () => {
    const { h, seen } = handler({ replies: [{ status: 429, body: "{}" }, orAnswer({ action: "flag", reason: "x" })] });
    const { json } = await run(h, attack());
    expect(seen.urls).toHaveLength(2);
    expect(json.llm.attempts).toBe(2);
    expect(json.proposal?.action).toBe("flag");
  });

  it("429 twice gives up and says so", async () => {
    const { h, seen } = handler({ replies: [{ status: 429, body: JSON.stringify({ error: { message: "Rate limit exceeded: free-models-per-min" } }) }] });
    const { json } = await run(h, attack());
    expect(seen.urls).toHaveLength(2);
    expect(json.llm.error).toMatch(/^HTTP 429 \(rate limited upstream\): Rate limit exceeded/);
    expect(json.proposal).toBeUndefined();
  });

  it("a network failure", async () => {
    const h = createJailbreakHandler({
      env: { OPENROUTER_API_KEY: OR_KEY },
      rpc: fakeRpc(),
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
      pqVerify,
      invoiceMessage: (gate, inv) => invoiceMessage(gate, { ...inv, amount: BigInt(inv.amount), dueDate: BigInt(inv.dueDate), signature: inv.vendorSig }),
    });
    const { json } = await run(h, attack());
    expect(json.llm.error).toBe("Could not reach the model provider.");
  });

  it("strips non-plain-text from model output", async () => {
    const { h } = handler({ replies: [orAnswer({ action: "pay", reason: "ok\u0007<img src=x onerror=alert(1)>‮evil", requestedPayee: ATTACKER })] });
    const { json } = await run(h, attack());
    expect(json.proposal?.reason).toBe("ok<img src=x onerror=alert(1)>evil");
  });
});

describe("no key ever reaches the browser", () => {
  it("not in errors that echo the key, nor in model text", async () => {
    const leaky = handler({
      replies: [{ status: 401, body: JSON.stringify({ error: { message: `Invalid key ${OR_KEY} (Bearer ${OR_KEY})` } }) }],
    });
    const a = await run(leaky.h, attack());
    expect(a.text).not.toContain(OR_KEY);
    expect(a.text).not.toContain("TESTKEY");
    expect(a.json.llm.error).toMatch(/HTTP 401.*\[redacted\]/);

    const echo = handler({ replies: [claudeAnswer({ action: "flag", reason: `key is ${AN_KEY}` }, `my key ${AN_KEY}`)] });
    const b = await run(echo.h, attack({ model: "claude" }));
    expect(b.text).not.toContain(AN_KEY);
    expect(b.text).not.toContain("TESTKEY");

    const status = await (await leaky.h.GET()).text();
    expect(status).not.toContain("TESTKEY");
  });
});

describe("availability, caps and rate limits", () => {
  it("a missing key disables only that provider", async () => {
    const { h } = handler({ env: { ANTHROPIC_API_KEY: "" } });
    const status = (await (await h.GET()).json()) as { models: { key: string; available: boolean; why?: string }[]; signatures: { injected: boolean; clean: boolean } };
    expect(status.models.find((m) => m.key === "claude")).toMatchObject({ available: false, why: expect.stringMatching(/ANTHROPIC_API_KEY/) });
    expect(status.models.find((m) => m.key === "nemotron")?.available).toBe(true);
    expect(status.signatures).toMatchObject({ injected: true, clean: true });
    expect((await h.POST(post(attack({ model: "claude" })))).status).toBe(503);
    expect((await h.POST(post(attack()))).status).toBe(200);
  });

  it("the Claude daily cap", async () => {
    const { h } = handler({ env: { STEWARD_CLAUDE_DAILY_CAP: "1" }, replies: [claudeAnswer({ action: "flag", reason: "x" })] });
    expect((await h.POST(post(attack({ model: "claude" })))).status).toBe(200);
    const second = await run(h, attack({ model: "claude" }));
    expect(second.res.status).toBe(429);
    expect(second.json.error).toBe("Daily cap reached, try the free model.");
    const status = (await (await h.GET()).json()) as { models: { key: string; available: boolean; why?: string }[] };
    expect(status.models.find((m) => m.key === "claude")).toMatchObject({ available: false, why: "Daily cap reached, try the free model." });
    expect((await h.POST(post(attack()))).status).toBe(200);
  });

  it("per-IP limits", async () => {
    const { h } = handler();
    const ip = { "x-forwarded-for": "203.0.113.9, 10.0.0.1" };
    for (let i = 0; i < 5; i++) expect((await h.POST(post(attack(), ip))).status).toBe(200);
    const sixth = await h.POST(post(attack(), ip));
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await h.POST(post(attack(), { "x-forwarded-for": "203.0.113.10" }))).status).toBe(200);
  });

  it("a testnet outage spends no model call and no Claude run", async () => {
    const { h, seen } = handler({ rpcDown: true, env: { STEWARD_CLAUDE_DAILY_CAP: "1" } });
    const r = await run(h, attack({ model: "claude" }));
    expect(r.res.status).toBe(502);
    expect(r.json.code).toBe("CHAIN_UNAVAILABLE");
    expect(seen.urls).toHaveLength(0);
    const status = (await (await h.GET()).json()) as { models: { key: string; remainingToday?: number }[] };
    expect(status.models.find((m) => m.key === "claude")?.remainingToday).toBe(1);
  });

  it("RateLimiter and DailyCap roll over at UTC midnight", () => {
    let t = Date.parse("2026-11-24T23:59:00Z");
    const rl = new RateLimiter(100, 2, () => t);
    expect(rl.take("a").ok).toBe(true);
    expect(rl.take("a").ok).toBe(true);
    expect(rl.take("a")).toMatchObject({ ok: false, scope: "day" });
    const cap = new DailyCap(1, () => t);
    expect(cap.take()).toBe(true);
    expect(cap.take()).toBe(false);
    t += 2 * 60_000;
    expect(rl.take("a").ok).toBe(true);
    expect(cap.take()).toBe(true);
  });

  it("reads the client address from the first proxy hop", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.2" }))).toBe("198.51.100.1");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("input validation", () => {
  it("refuses anything unexpected", async () => {
    const { h } = handler();
    const cases: [unknown, RegExp][] = [
      [attack({ model: "gpt-4o" }), /model must be/],
      [attack({ guard: "maybe" }), /guard must be/],
      [attack({ invoice: "other" }), /invoice must be/],
      [attack({ memoText: "x".repeat(1001) }), /longer than 1000/],
      [attack({ emailBody: 42 }), /must be text/],
      [{ ...attack(), apiKey: "x" }, /Unknown field/],
      [[1, 2], /JSON object/],
    ];
    for (const [body, err] of cases) {
      const r = await run(h, body);
      expect(r.res.status).toBe(400);
      expect(r.json.error).toMatch(err);
    }
    expect((await h.POST(post("{nope"))).status).toBe(400);
    expect((await h.POST(post(attack(), { "content-type": "text/plain" }))).status).toBe(415);
    expect((await h.POST(post(attack(), { origin: "https://evil.example" }))).status).toBe(403);
    expect((await h.POST(post(attack(), { origin: "http://localhost:3000" }))).status).toBe(200);
    expect((await h.POST(post(JSON.stringify({ ...attack(), memoText: "y".repeat(9000) })))).status).toBe(413);
  });

  it("keeps plain text only", () => {
    expect(plainText("a\r\nb\u0000c‮d\te", 100)).toBe("a\nbcd\te");
    expect(plainText("abcdef", 3)).toBe("abc…");
    const parsed = parseRunInput(attack({ memoText: "hi\u0007" }));
    expect(parsed.ok && parsed.input.memoText).toBe("hi");
    expect(redactSecrets("x sk-ant-api03-abcdefgh y sk-or-v1-12345678 z", [])).toBe("x [redacted] y [redacted] z");
  });
});

describe("revert decoding", () => {
  it("decodes the reverts the live testnet returned for these calls", () => {
    // Observed on qorechain-diana with eth_call from the agent account (24 Nov 2026).
    const wrongPayee = "0x3071b09a00000000000000000000000000000000000000000000000000000000000000a1000000000000000000000000f09cc23e992a4591a456836d7223655399d0bb90";
    expect(decodeRevert(wrongPayee)).toMatchObject({ name: "WrongPayee", args: ["0x00000000000000000000000000000000000000A1", "0xf09cc23e992A4591A456836D7223655399D0BB90"] });
    expect(decodeRevert("0x37e8456b")?.name).toBe("SignatureInvalid");
    expect(decodeRevert("0x52f49c950000000000000000000000000000000000000000000000000000000000000001")?.name).toBe("NotAgent");
    expect(decodeRevert("0xdeadbeef")).toBeUndefined();
    expect(decodeRevert(undefined)).toBeUndefined();
  });
});
