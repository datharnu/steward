/**
 * One planner call to the selected model, with the exact request ClaudePlanner sends
 * (agent/planner.ts). No fallback: if the model does not give a usable answer, the run says so.
 */
import {
  ANTHROPIC_URL,
  OPENROUTER_URL,
  anthropicRequestBody,
  openRouterRequestBody,
  parseAnthropicResponse,
  parseOpenRouterResponse,
  type PlannerPrompts,
  type PlannerProposal,
} from "./core";
import { plainText, redactSecrets, type Provider } from "./input";

export type ModelCall = {
  provider: Provider;
  model: string;
  apiKey: string;
  prompts: PlannerPrompts;
  fetchImpl?: typeof fetch;
  /** Whole budget for the call, retries included (default 45 s). */
  budgetMs?: number;
  /** Extra attempts after HTTP 429/529 (default 1). */
  retries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type ModelAnswer = {
  ok: boolean;
  httpStatus?: number;
  attempts: number;
  durationMs: number;
  proposal?: PlannerProposal;
  /** Why there is no proposal, in plain text, with any key removed. */
  error?: string;
  /** The model's own text (Claude's prose next to the tool call, or OpenRouter's content), plain text. */
  modelText?: string;
};

const MIN_ATTEMPT_MS = 8_000;

function providerMessage(raw: string): string | undefined {
  try {
    const body = JSON.parse(raw) as { error?: { message?: unknown } | string };
    const m = typeof body.error === "string" ? body.error : body.error?.message;
    return typeof m === "string" ? m : undefined;
  } catch {
    return undefined;
  }
}

export async function callPlannerModel(call: ModelCall): Promise<ModelAnswer> {
  const fetchImpl = call.fetchImpl ?? fetch;
  const sleep = call.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const budget = call.budgetMs ?? 45_000;
  const retries = call.retries ?? 1;
  const started = Date.now();
  const deadline = started + budget;
  const url = call.provider === "anthropic" ? ANTHROPIC_URL : OPENROUTER_URL;
  const body = call.provider === "anthropic" ? anthropicRequestBody(call.model, call.prompts) : openRouterRequestBody(call.model, call.prompts);
  const headers: Record<string, string> =
    call.provider === "anthropic"
      ? { "content-type": "application/json", "x-api-key": call.apiKey, "anthropic-version": "2023-06-01" }
      : { "content-type": "application/json", authorization: `Bearer ${call.apiKey}` };
  const clean = (s: string, max: number) => plainText(redactSecrets(s, [call.apiKey]), max);
  const done = (a: Omit<ModelAnswer, "durationMs">): ModelAnswer => ({ ...a, durationMs: Date.now() - started });

  for (let attempt = 1; ; attempt++) {
    const left = deadline - Date.now();
    let res: Response;
    let raw: string;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.max(1_000, left)),
      });
      raw = await res.text();
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      return done({
        ok: false,
        attempts: attempt,
        error: timedOut ? `The model did not answer within ${Math.round(budget / 1000)} s.` : "Could not reach the model provider.",
      });
    }
    if (!res.ok) {
      const retryable = res.status === 429 || res.status === 529;
      if (retryable && attempt <= retries) {
        const ra = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 4_000) : (call.retryDelayMs ?? 2_000);
        if (deadline - Date.now() - wait >= MIN_ATTEMPT_MS) {
          await sleep(wait);
          continue;
        }
      }
      const msg = providerMessage(raw);
      return done({
        ok: false,
        httpStatus: res.status,
        attempts: attempt,
        error: clean(
          `HTTP ${res.status}${res.status === 429 ? " (rate limited upstream)" : res.status === 529 ? " (provider overloaded)" : ""}${msg ? `: ${msg}` : ""}`,
          300,
        ),
      });
    }
    const parsed = call.provider === "anthropic" ? parseAnthropicResponse(raw) : parseOpenRouterResponse(raw);
    const modelText = parsed.modelText ? clean(parsed.modelText, 2_000) : undefined;
    if (!parsed.proposal) {
      return done({ ok: false, httpStatus: res.status, attempts: attempt, error: parsed.error ?? "no usable answer", modelText });
    }
    const proposal: PlannerProposal = { action: parsed.proposal.action, reason: clean(parsed.proposal.reason, 1_000) };
    if (parsed.proposal.requestedPayee) proposal.requestedPayee = clean(parsed.proposal.requestedPayee, 120);
    return done({ ok: true, httpStatus: res.status, attempts: attempt, proposal, modelText });
  }
}
