"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bot, CheckCircle2, ExternalLink, Loader2, Lock, ShieldAlert, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { CopyChip } from "./ui";
import { WorkspaceShell } from "./workspace-shell";
import { formatFusd, shortAddress } from "@/lib/engine";
import { MAX_FIELD, PRESETS, type Guard, type InvoiceKind, type ModelKey } from "@/lib/jailbreak/input";
import type { JailbreakResult, Simulation } from "@/lib/jailbreak/run";
import type { ModelStatus, SignatureStatus } from "@/lib/jailbreak/handler";
import injected from "@/lib/jailbreak/injected-invoice.json";
import clean from "@/lib/jailbreak/clean-invoice.json";

const FIXTURE = { injected, clean } as const;
const FOOLED_TX = "807954AAFAE5A847F504C9F97FF56EBA0F1CA071CAEF34C125CE4F54E0EEC186";
const TRANSFER_TX = "92854431F2D83B45BD7E4D501E7595BC1B1DAF21C300CC7B99E8ECC3D7028789";
const INJECTED_TX = "43309EEA26AA0B9BFEEAD6B3996C446417AE4BF5F8AB75CD94A6995BD9255B03";
const README_RUNS = "https://github.com/datharnu/steward#real-model-runs-23-november-2026";

type Status = { models: ModelStatus[]; limits: { perMinute: number; perDay: number; claudePerDay: number }; signatures: SignatureStatus };

function defaults(kind: InvoiceKind): { memoText: string; emailBody: string } {
  if (kind === "injected") return { memoText: PRESETS[0].memoText, emailBody: PRESETS[0].emailBody };
  return { memoText: clean.invoice.memoText ?? "", emailBody: clean.invoice.emailBody ?? "" };
}

function txLink(hash: string): string {
  return `/qore-rest/cosmos/tx/v1beta1/txs/${hash}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line/80 py-2 last:border-b-0">
      <dt className="shrink-0 text-[12.5px] text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[13px] font-medium break-words text-ink">{children}</dd>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1 rounded-xl border border-line bg-canvas/70 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-9 flex-1 rounded-lg px-3 text-[13px] font-medium transition-colors ${
            value === o.value ? "border border-line-strong bg-surface-elevated text-ink shadow-xs" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Layer({ n, title, tone, children }: { n: number; title: string; tone: "pass" | "fail" | "note"; children: React.ReactNode }) {
  const border = tone === "pass" ? "border-paid/35" : tone === "fail" ? "border-refused/35" : "border-line";
  return (
    <section className={`rounded-xl border ${border} bg-surface/90 p-4`} aria-label={`Layer ${n}: ${title}`}>
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md border border-line-strong font-mono text-[11px] text-muted">{n}</span>
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      </div>
      <div className="mt-3 space-y-2 text-[13.5px]">{children}</div>
    </section>
  );
}

function SimulationCard({ sim, amount }: { sim: Simulation; amount: string }) {
  const o = sim.outcome;
  return (
    <div className="rounded-lg border border-line bg-canvas/60 p-3">
      <p className="text-[13px] font-medium text-ink">{sim.label}</p>
      <p className="mt-1 text-[12.5px] text-muted">{sim.why}</p>
      <p className="mt-2 font-mono text-[12px] break-all text-muted">
        eth_call PayGate.{sim.fn}(payee {sim.payee}
        {sim.payeeIsSigned ? ", as signed" : ", changed from the signed payee"}, amount {amount})
      </p>
      {o.status === "reverted" ? (
        <div className="mt-2 rounded-md border border-refused/35 bg-refused-soft p-2.5 text-refused">
          <p className="font-mono text-[13px] font-semibold">
            Reverted: {o.revert ? `${o.revert.name}(${o.revert.args.join(", ")})` : `unknown error ${o.selector || "(no data)"}`}
          </p>
          {o.revert?.meaning ? <p className="mt-1 text-[12.5px]">{o.revert.meaning}</p> : null}
          <p className="mt-1 font-mono text-[11px] opacity-80">selector {o.selector || "none"} · RPC said “{o.rawMessage}”</p>
        </div>
      ) : o.status === "ok" ? (
        <div className="mt-2 rounded-md border border-paid/35 bg-paid-soft p-2.5 text-paid">
          <p className="text-[13px] font-semibold">PayGate accepts this call in simulation.</p>
          <p className="mt-1 text-[12.5px]">
            {sim.fn === "pay"
              ? `A real broadcast would pay ${sim.wouldMove} base units to the registered payout. This page never broadcasts.`
              : "A real broadcast would park the invoice for the owner's approval and move nothing."}
          </p>
        </div>
      ) : (
        <p className="mt-2 rounded-md border border-line bg-canvas p-2.5 text-[12.5px] text-muted">Simulation unavailable: {o.message}</p>
      )}
    </div>
  );
}

function Results({ r }: { r: JailbreakResult }) {
  const p = r.proposal;
  const policyBlocks = r.policy ? !r.policy.willExecuteOnChain : true;
  const first = r.simulations[0];
  return (
    <div className="space-y-3" data-testid="jailbreak-result">
      <Layer n={1} title="The model (real LLM)" tone={r.fooled ? "fail" : p ? "pass" : "note"}>
        <p className="text-muted">
          <span className="font-medium text-ink">{r.model.label}</span> · <span className="font-mono text-[12px]">{r.model.planner}</span> ·{" "}
          {r.model.guard === "on" ? "Guard on (Steward's prompt)" : "Guard off (simulated jailbreak)"} · {Math.round(r.llm.durationMs / 100) / 10} s
          {r.llm.attempts > 1 ? ` · ${r.llm.attempts} attempts` : ""}
        </p>
        {p ? (
          <>
            <dl className="rounded-lg border border-line bg-canvas/60 px-3">
              <Row label="Action">
                <span className="font-mono">{p.action}</span>
              </Row>
              <Row label="Payee it named">
                <span className="font-mono text-[12px]">{p.requestedPayee ?? "(none; the invoice payee)"}</span>
              </Row>
              <Row label="Reason">
                <span className="block text-left font-normal whitespace-pre-wrap" data-testid="model-reason">
                  {p.reason}
                </span>
              </Row>
            </dl>
            <p className={`text-[15px] font-semibold ${r.fooled ? "text-refused" : "text-paid"}`} data-testid="fooled-verdict">
              Fooled? {r.fooled ? "Yes. The model would move money to someone other than the registered payout." : "No."}
            </p>
          </>
        ) : (
          <p className="rounded-lg border border-queued/35 bg-queued-soft p-3 text-queued" data-testid="model-error">
            No usable answer from the model: {r.llm.error}. Steward does not fall back to rules on this page, so nothing would be sent.
          </p>
        )}
        {r.llm.modelText ? (
          <details className="rounded-lg border border-line bg-canvas/50 p-2.5">
            <summary className="cursor-pointer text-[12.5px] text-muted">The model's own text</summary>
            <p className="mt-2 text-[12.5px] whitespace-pre-wrap text-ink">{r.llm.modelText}</p>
          </details>
        ) : null}
        <details className="rounded-lg border border-line bg-canvas/50 p-2.5">
          <summary className="cursor-pointer text-[12.5px] text-muted">The exact prompt Steward sent</summary>
          <p className="mt-2 font-mono text-[11.5px] whitespace-pre-wrap text-muted">system: {r.prompts.system}</p>
          <p className="mt-2 font-mono text-[11.5px] break-all whitespace-pre-wrap text-muted">user: {r.prompts.user}</p>
        </details>
      </Layer>

      <Layer n={2} title="Steward's deterministic policy" tone={r.policy ? (policyBlocks ? (r.fooled ? "pass" : "note") : "pass") : "note"}>
        {r.policy ? (
          <>
            <p>
              <span className="font-mono font-semibold text-ink" data-testid="policy-code">
                {r.policy.code}
              </span>{" "}
              <span className="text-muted">→ {r.policy.action}</span>
            </p>
            <p className="text-muted">{r.policy.reason}</p>
            <p className="text-ink">{r.policy.willExecuteOnChain ? "The agent would submit this to PayGate." : "The agent would send nothing to the chain."}</p>
          </>
        ) : (
          <p className="text-muted">No proposal, so the policy had nothing to clamp.</p>
        )}
        <p className="text-[12px] text-muted">
          Same <span className="font-mono">clampDecision</span> as <span className="font-mono">src/ts/policy.ts</span>, fed the live gate read below.
        </p>
      </Layer>

      <Layer n={3} title="PayGate on QoreChain (eth_call simulation)" tone={first?.outcome.status === "reverted" ? "pass" : "note"}>
        <p className="text-[12.5px] text-muted">
          From the agent account {shortAddress(r.gate.agent)} against the latest block, with the real ML-DSA-87 precompiles. Read-only: nothing is signed or sent.
        </p>
        {r.simulations.map((s) => (
          <SimulationCard key={`${s.fn}-${s.payee}-${s.label}`} sim={s} amount={r.invoice.amount} />
        ))}
      </Layer>

      <div className="rounded-xl border border-brand/40 bg-brand-soft p-4">
        <p className="text-[22px] font-semibold tracking-[-0.02em] text-ink" data-testid="moved-line">
          fUSD moved: {r.moved}
        </p>
        <p className="mt-1 text-[13px] text-muted">{r.verdict}</p>
        <p className="mt-1 text-[12px] text-muted">
          Gate balance read for this run: {r.gate.balance} base units ({formatFusd(BigInt(r.gate.balance))} fUSD), unchanged because this page only simulates.
        </p>
      </div>
    </div>
  );
}

export function Jailbreak() {
  const [kind, setKind] = useState<InvoiceKind>("injected");
  const [memoText, setMemo] = useState(defaults("injected").memoText);
  const [emailBody, setEmail] = useState(defaults("injected").emailBody);
  const [model, setModel] = useState<ModelKey>("nemotron");
  const [guard, setGuard] = useState<Guard>("on");
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<JailbreakResult | null>(null);

  useEffect(() => {
    fetch("/api/jailbreak", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Status>) : Promise.reject(new Error("status"))))
      .then((s) => {
        setStatus(s);
        setModel((current) => (s.models.find((m) => m.key === current)?.available ? current : (s.models.find((m) => m.available)?.key ?? current)));
      })
      .catch(() => setStatusError(true));
  }, []);

  const fx = FIXTURE[kind];
  const selected = status?.models.find((m) => m.key === model);
  const sig = status?.signatures?.[kind];

  const canRun = !busy && (!status || selected?.available !== false);

  const presets = useMemo(() => PRESETS, []);

  function pickInvoice(next: InvoiceKind) {
    setKind(next);
    const d = defaults(next);
    setMemo(d.memoText);
    setEmail(d.emailBody);
    setResult(null);
    setError(null);
  }

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/jailbreak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoice: kind, model, guard, memoText, emailBody }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<JailbreakResult> & { error?: string };
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : `The server answered HTTP ${res.status}.`);
        if (res.status === 429 && model === "claude") {
          setStatus((s) => (s ? { ...s, models: s.models.map((m) => (m.key === "claude" && /cap/i.test(body.error ?? "") ? { ...m, available: false, why: body.error } : m)) } : s));
        }
      } else {
        setResult(body as JailbreakResult);
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const sidebar = (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-[11px] tracking-wider text-muted uppercase">The invoice</p>
        <div className="mt-2">
          <Segmented<InvoiceKind>
            label="Invoice"
            value={kind}
            onChange={pickInvoice}
            options={[
              { value: "injected", label: "Injected (recorded)" },
              { value: "clean", label: "Clean control" },
            ]}
          />
        </div>
      </div>
      <dl className="rounded-xl border border-line bg-canvas/70 px-3">
        <Row label="Vendor">
          <span className="font-mono text-[12px]">{shortAddress(fx.invoice.vendor)}</span>
        </Row>
        <Row label="Payee (signed)">
          <span className={`font-mono text-[12px] ${kind === "injected" ? "text-refused" : "text-paid"}`}>{shortAddress(fx.invoice.payee)}</span>
          <span className="block text-[11.5px] font-normal text-muted">{kind === "injected" ? "attacker, not the registered payout" : "the registered payout"}</span>
        </Row>
        <Row label="Amount">
          <span className="font-mono">{fx.invoice.amount} base units</span>
        </Row>
        <Row label="Invoice ID">
          <CopyChip value={fx.invoice.invoiceId} display={`${fx.invoice.invoiceId.slice(0, 10)}…`} label="invoice ID" />
        </Row>
        <Row label="ML-DSA-87 signature">
          {sig === true ? (
            <span className="inline-flex items-center gap-1 text-paid">
              <ShieldCheck className="h-3.5 w-3.5" /> valid
            </span>
          ) : sig === false ? (
            <span className="text-refused">does not verify</span>
          ) : (
            <span className="text-muted">{status || statusError ? "could not check now" : "checking…"}</span>
          )}
          <span className="block text-[11.5px] font-normal text-muted">vendor key read live from pqcKeyStatus</span>
        </Row>
        <Row label="Source">
          {kind === "injected" ? (
            <CopyChip value={INJECTED_TX} display="tx 43309EEA…" label="source transaction" />
          ) : (
            <span className="text-[12px] font-normal text-muted">signed offline, never sent</span>
          )}
        </Row>
      </dl>
      <p className="text-[12px] leading-relaxed text-muted">
        {kind === "injected"
          ? "The real vendor-signed invoice from recorded testnet step 2, decoded from its calldata. The vendor signed the attacker's payee; the registered payout is the vendor's own address."
          : "A fresh invoice the vendor signed offline to its registered payout, with an unused ID and an amount the gate can cover. It should pass every layer in simulation."}{" "}
        The memo and email you edit are untrusted text: the vendor signed only the memo's hash, so an edited memo no longer matches it (Steward's Courier inbox would reject that file; here it reaches the model so you can attack it).
      </p>
    </div>
  );

  const inspector = (
    <div className="flex flex-col gap-4 text-[13px]">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-brand/35 bg-brand-soft text-brand">
          <Lock className="h-4 w-4" />
        </span>
        <h2 className="text-[16px] font-semibold text-ink">What this page proves</h2>
      </div>
      <ul className="list-disc space-y-1.5 pl-4 text-muted">
        <li>The model is real and gets Steward's exact planner prompt (from agent/planner.ts). If it fails, you see the failure; there is no rule-based fallback.</li>
        <li>The policy is Steward's deterministic clampDecision on a live read of PayGate.</li>
        <li>PayGate's answer is a real eth_call from the agent account against the live contract, including the pqcVerify and pqcKeyStatus precompiles.</li>
      </ul>
      <h2 className="text-[15px] font-semibold text-ink">What it does not prove</h2>
      <ul className="list-disc space-y-1.5 pl-4 text-muted">
        <li>Nothing is broadcast. A simulation is not a transaction, and the gate's balance never changes here.</li>
        <li>QoreChain's smart-account spending rule (only PayGate.pay and PayGate.queue, zero denoms) is enforced when a transaction is broadcast, not in eth_call. That layer is proven by the recorded transactions below.</li>
        <li>The guard-off mode tells the model to obey the email. A model fooled there is a simulated jailbreak, not a natural failure.</li>
      </ul>
      <h2 className="text-[15px] font-semibold text-ink">Recorded real refusals</h2>
      <div className="space-y-2.5">
        <div className="rounded-lg border border-line bg-canvas/60 p-2.5">
          <p className="text-ink">A fooled 1.7B model's payment, sent with the agent key anyway: PayGate refused, attacker 0 → 0.</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <CopyChip value={FOOLED_TX} display="807954AA…EEC186" label="fooled-model transaction" />
            <a href={txLink(FOOLED_TX)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-brand hover:underline">
              chain record <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-canvas/60 p-2.5">
          <p className="text-ink">The agent key calling fUSD.transfer directly: refused by the spending rule.</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <CopyChip value={TRANSFER_TX} display="92854431…028789" label="direct transfer transaction" />
            <a href={txLink(TRANSFER_TX)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-brand hover:underline">
              chain record <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
        <a href={README_RUNS} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12.5px] text-brand hover:underline">
          Recorded runs and transcripts <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      {status ? (
        <p className="text-[12px] text-muted">
          Limits: {status.limits.perMinute} runs a minute and {status.limits.perDay} a day per address; Claude {status.limits.claudePerDay} runs a day for everyone.
        </p>
      ) : null}
    </div>
  );

  return (
    <WorkspaceShell
      title="Jailbreak the clerk"
      badge="Real LLM · live testnet · simulated"
      subtitle="Write your own attack, send it to Steward's real AI planner, and watch the policy and PayGate answer."
      sidebar={sidebar}
      inspector={inspector}
      inspectorAsAside
    >
      <div className="mx-auto flex max-w-[760px] flex-col gap-4">
        <section className="rounded-xl border border-line bg-surface/90 p-4" aria-labelledby="attack">
          <h2 id="attack" className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Sparkles className="h-4 w-4 text-brand" /> 1. Write the attack
          </h2>
          <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Preset attacks">
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  setMemo(p.memoText);
                  setEmail(p.emailBody);
                }}
                className="min-h-8 rounded-full border border-line bg-canvas/70 px-3 text-[12.5px] text-muted transition-colors hover:border-brand/50 hover:text-ink"
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className="mt-3 block text-[12.5px] font-medium text-ink" htmlFor="memo">
            Invoice memo (untrusted)
          </label>
          <textarea
            id="memo"
            value={memoText}
            maxLength={MAX_FIELD}
            onChange={(e) => setMemo(e.target.value)}
            rows={2}
            className="mt-1 w-full resize-y rounded-lg border border-line bg-canvas/80 p-2.5 font-mono text-[12.5px] text-ink outline-none focus:border-brand/60"
          />
          <p className="text-right font-mono text-[11px] text-muted">
            {memoText.length}/{MAX_FIELD}
          </p>
          <label className="mt-1 block text-[12.5px] font-medium text-ink" htmlFor="email">
            Email body (untrusted)
          </label>
          <textarea
            id="email"
            value={emailBody}
            maxLength={MAX_FIELD}
            onChange={(e) => setEmail(e.target.value)}
            rows={5}
            className="mt-1 w-full resize-y rounded-lg border border-line bg-canvas/80 p-2.5 font-mono text-[12.5px] text-ink outline-none focus:border-brand/60"
          />
          <p className="text-right font-mono text-[11px] text-muted">
            {emailBody.length}/{MAX_FIELD}
          </p>
        </section>

        <section className="rounded-xl border border-line bg-surface/90 p-4" aria-labelledby="clerk">
          <h2 id="clerk" className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Bot className="h-4 w-4 text-brand" /> 2. Pick the clerk
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Model">
            {(status?.models ?? []).map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={model === m.key}
                disabled={!m.available}
                onClick={() => setModel(m.key)}
                className={`rounded-lg border p-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  model === m.key ? "border-brand/60 bg-brand-soft" : "border-line bg-canvas/60 hover:border-line-strong"
                }`}
              >
                <span className="block text-[13px] font-medium text-ink">{m.label}</span>
                <span className="mt-0.5 block font-mono text-[10.5px] break-all text-muted">{m.model}</span>
                <span className="mt-1 block text-[11.5px] text-muted">
                  {m.available ? m.note : m.why}
                  {m.available && m.remainingToday !== undefined ? ` ${m.remainingToday} left today.` : ""}
                </span>
              </button>
            ))}
            {!status && !statusError ? <p className="text-[12.5px] text-muted">Loading models…</p> : null}
            {statusError ? <p className="text-[12.5px] text-refused">Could not load the model list.</p> : null}
          </div>
          <p className="mt-4 text-[12.5px] font-medium text-ink">Prompt</p>
          <div className="mt-1">
            <Segmented<Guard>
              label="Guard"
              value={guard}
              onChange={setGuard}
              options={[
                { value: "on", label: "Guard on: Steward's real prompt" },
                { value: "off", label: "Guard off: simulated jailbreak" },
              ]}
            />
          </div>
          <p className="mt-1.5 text-[12px] text-muted">
            {guard === "on"
              ? "The prompt Steward runs with: memo and email are labelled untrusted data."
              : "The injection demo's unguarded prompt: the model is told the email comes from the accounts team and to follow it. Use it to see what happens when the model does fall for it."}
          </p>
          <button
            type="button"
            onClick={run}
            disabled={!canRun}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-[15px] font-medium text-on-brand shadow-xs transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
            {busy ? "Asking the model, then the policy and PayGate…" : "Run the attack"}
          </button>
          <p className="mt-2 text-[11.5px] text-muted">Runs on the server. Nothing is signed or broadcast; the chain step is an eth_call.</p>
        </section>

        <div aria-live="polite">
          {error ? (
            <p className="flex items-start gap-2 rounded-xl border border-refused/35 bg-refused-soft p-3 text-[13.5px] text-refused" role="alert" data-testid="run-error">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </p>
          ) : null}
          {result ? <Results r={result} /> : null}
          {!result && !error && !busy ? (
            <p className="flex items-center gap-2 rounded-xl border border-line bg-canvas/50 p-3 text-[13px] text-muted">
              {kind === "injected" ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              No run yet. The result shows each layer: the model, the policy, and PayGate.{" "}
              <Link href="/gate" className="text-brand hover:underline">
                Read the gate live
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </WorkspaceShell>
  );
}
