/**
 * The /api/jailbreak request handler, without Next.js, so tests can drive it with mocked
 * fetch and RPC. `app/api/jailbreak/route.ts` wires it to the real environment.
 */
import { hexToBytes } from "viem";
import { ChainUnavailableError, httpRpc, readVendorKey, type Rpc } from "./chain";
import type { Address, InvoiceRecord } from "./core";
import { MAX_BODY_BYTES, MODELS, modelOption, parseRunInput, redactSecrets, type ModelKey } from "./input";
import { DailyCap, RateLimiter, clientIp, intFromEnv } from "./limits";
import { callPlannerModel } from "./llm";
import { FIXTURES, ML_DSA_87, runJailbreak } from "./run";

export type HandlerEnv = {
  OPENROUTER_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  STEWARD_CLAUDE_DAILY_CAP?: string;
  STEWARD_JAILBREAK_PER_MINUTE?: string;
  STEWARD_JAILBREAK_PER_DAY?: string;
};

export type HandlerDeps = {
  env: HandlerEnv;
  rpc?: Rpc;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Verifies an ML-DSA-87 signature. */
  pqVerify: (pubkey: Uint8Array, message: Uint8Array, signature: Uint8Array) => boolean;
  /** The bytes a vendor signs (VendorSig.encode). */
  invoiceMessage: (gate: Address, invoice: InvoiceRecord) => `0x${string}`;
  modelBudgetMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type ModelStatus = {
  key: ModelKey;
  label: string;
  model: string;
  provider: string;
  note: string;
  available: boolean;
  why?: string;
  remainingToday?: number;
};

export type SignatureStatus = {
  injected: boolean | null;
  clean: boolean | null;
  checkedAt: string;
  source: "pqcKeyStatus (live)" | "unavailable";
};

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

export function createJailbreakHandler(deps: HandlerDeps) {
  const now = deps.now ?? Date.now;
  const env = deps.env;
  const limiter = new RateLimiter(intFromEnv(env.STEWARD_JAILBREAK_PER_MINUTE, 5, 1, 1000), intFromEnv(env.STEWARD_JAILBREAK_PER_DAY, 30, 1, 100_000), now);
  const claudeCap = new DailyCap(intFromEnv(env.STEWARD_CLAUDE_DAILY_CAP, 30, 0, 100_000), now);
  const rpc = deps.rpc ?? httpRpc();
  const secrets = [env.OPENROUTER_API_KEY, env.ANTHROPIC_API_KEY];

  function keyFor(key: ModelKey): string | undefined {
    const k = modelOption(key).provider === "anthropic" ? env.ANTHROPIC_API_KEY : env.OPENROUTER_API_KEY;
    return k && k.trim() ? k.trim() : undefined;
  }

  function status(): ModelStatus[] {
    return MODELS.map((m) => {
      const base = { key: m.key, label: m.label, model: m.model, provider: m.provider, note: m.note };
      if (!keyFor(m.key)) {
        return { ...base, available: false, why: `Not configured on this deployment (${m.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENROUTER_API_KEY"} is not set).` };
      }
      if (m.provider === "anthropic") {
        const remainingToday = claudeCap.remaining();
        return remainingToday > 0
          ? { ...base, available: true, remainingToday }
          : { ...base, available: false, remainingToday, why: "Daily cap reached, try the free model." };
      }
      return { ...base, available: true };
    });
  }

  function verifySig(invoice: InvoiceRecord, gate: Address, pubkey: `0x${string}`): boolean {
    try {
      return deps.pqVerify(hexToBytes(pubkey), hexToBytes(deps.invoiceMessage(gate, invoice)), hexToBytes(invoice.vendorSig)) === true;
    } catch {
      return false;
    }
  }

  // The vendor signature on both fixtures, checked against the vendor's live on-chain key. Cached briefly.
  let sigCache: { at: number; value: SignatureStatus } | undefined;
  async function signatures(): Promise<SignatureStatus> {
    if (sigCache && now() - sigCache.at < 5 * 60_000) return sigCache.value;
    try {
      const out = {} as Record<"injected" | "clean", boolean>;
      for (const kind of ["injected", "clean"] as const) {
        const fx = FIXTURES[kind];
        const key = await readVendorKey(rpc, fx.invoice.vendor);
        out[kind] = key.registered && key.algorithmId === ML_DSA_87 && key.possessionProven && verifySig(fx.invoice, fx.gate, key.pubkey);
      }
      const value: SignatureStatus = { ...out, checkedAt: new Date(now()).toISOString(), source: "pqcKeyStatus (live)" };
      sigCache = { at: now(), value };
      return value;
    } catch {
      return { injected: null, clean: null, checkedAt: new Date(now()).toISOString(), source: "unavailable" };
    }
  }

  async function GET(): Promise<Response> {
    return json(200, {
      models: status(),
      limits: { perMinute: limiter.perMinute, perDay: limiter.perDay, claudePerDay: claudeCap.cap },
      signatures: await signatures(),
    });
  }

  async function POST(req: Request): Promise<Response> {
    const origin = req.headers.get("origin");
    if (origin) {
      let sameHost = false;
      try {
        sameHost = new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host);
      } catch {
        sameHost = false;
      }
      if (!sameHost) return json(403, { error: "Cross-site requests are not accepted." });
    }
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return json(415, { error: "Send JSON." });
    }
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) return json(413, { error: "The request is too large." });
    const text = await req.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return json(413, { error: "The request is too large." });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, { error: "The request is not valid JSON." });
    }
    const parsed = parseRunInput(body);
    if (!parsed.ok) return json(400, { error: parsed.error });
    const input = parsed.input;

    const apiKey = keyFor(input.model);
    if (!apiKey) {
      const s = status().find((m) => m.key === input.model);
      return json(503, { error: s?.why ?? "This model is not available.", code: "MODEL_UNAVAILABLE" });
    }
    const option = modelOption(input.model);
    if (option.provider === "anthropic" && claudeCap.remaining() <= 0) {
      return json(429, { error: "Daily cap reached, try the free model.", code: "CLAUDE_DAILY_CAP" });
    }
    const limit = limiter.take(clientIp(req.headers));
    if (!limit.ok) {
      return json(
        429,
        {
          error: limit.scope === "minute" ? "Too many runs this minute. Wait a moment and try again." : "You have used today's runs from this address. Try again tomorrow.",
          code: limit.scope === "minute" ? "RATE_MINUTE" : "RATE_DAY",
          retryAfterSec: limit.retryAfterSec,
        },
        { "retry-after": String(limit.retryAfterSec) },
      );
    }
    if (option.provider === "anthropic" && !claudeCap.take()) {
      return json(429, { error: "Daily cap reached, try the free model.", code: "CLAUDE_DAILY_CAP" });
    }

    try {
      const result = await runJailbreak(input, {
        rpc,
        nowUnix: Math.floor(now() / 1000),
        askModel: (prompts) =>
          callPlannerModel({
            provider: option.provider,
            model: option.model,
            apiKey,
            prompts,
            fetchImpl: deps.fetchImpl,
            budgetMs: deps.modelBudgetMs,
            sleep: deps.sleep,
          }),
        verifyVendorSig: verifySig,
      });
      // Belt and braces: nothing that leaves the server may contain a key.
      return new Response(redactSecrets(JSON.stringify(result), secrets), { status: 200, headers: JSON_HEADERS });
    } catch (err) {
      if (err instanceof ChainUnavailableError) {
        if (option.provider === "anthropic") claudeCap.refund();
        return json(502, { error: `${err.message} No model was called. Try again in a moment.`, code: "CHAIN_UNAVAILABLE" });
      }
      return json(500, { error: "The run failed on the server. Nothing was sent anywhere.", code: "INTERNAL" });
    }
  }

  return { GET, POST, status };
}
