"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { FileCheck2, FileKey2, KeyRound, ShieldCheck } from "lucide-react";

const STEP_MS = 6500;
const EASE = [0.22, 1, 0.36, 1] as const;

type StepSpec = {
  n: string;
  label: string;
  state: string;
  title: string;
  body: string;
  who: string;
  onChain: string;
  never: string;
  answer: string;
  icon: typeof FileKey2;
  trace: [string, string, "ok" | "dim"][];
};

const STEPS: StepSpec[] = [
  {
    n: "01",
    label: "Mandate sealed",
    state: "QoreSeal",
    title: "The owner seals the budget and registers the vendor.",
    body: "The owner signs a mandate with QoreSign and seals it to the agent’s key with QoreSeal. Separately, the owner adds the vendor’s payout and per-invoice cap to PayGate behind an ML-DSA-87 signature and a 60-second timelock.",
    who: "The owner’s account (hybrid-signed EVM window)",
    onChain: "Vendor payout 0xf09c…BB90, per-invoice cap 0.020000 fUSD, 60s timelock",
    never: "An agent adding a vendor, raising a cap, or changing a payout",
    answer: "Vendor registered on PayGate. Mandate sealed to the agent key.",
    icon: FileKey2,
    trace: [
      ["mandateId", "mandate-first-payment", "ok"],
      ["perInvoiceCap", "0.020000 fUSD", "ok"],
      ["timelock", "60s · owner ML-DSA", "dim"],
    ],
  },
  {
    n: "02",
    label: "Vendor signs",
    state: "ML-DSA-87",
    title: "The vendor stamps the invoice with its post-quantum key.",
    body: "Each invoice binds the vendor address, registered payout, token, exact amount, unique invoice id, due date, and memo hash under the VendorSig domain, signed with ML-DSA-87.",
    who: "The vendor, offline or in its own browser",
    onChain: "Nothing yet — the signed invoice arrives in the agent’s inbox",
    never: "An unsigned email or forged key passing PayGate’s pqcVerify check",
    answer: "Invoice stamped with ML-DSA-87. Memo stays untrusted data.",
    icon: KeyRound,
    trace: [
      ["invoiceKey", "0xfb17c7…75a3", "ok"],
      ["amount", "0.010000 fUSD", "ok"],
      ["signature", "ML-DSA-87 · VendorSig.v1", "dim"],
    ],
  },
  {
    n: "03",
    label: "Gate verifies",
    state: "PayGate.pay",
    title: "The chain rule narrows the call; PayGate checks every byte.",
    body: "The agent’s spending rule allows only PayGate.pay and PayGate.queue with a 1 uqor limit and no denoms. PayGate verifies the vendor’s ML-DSA-87 signature via the pqcVerify precompile (0x…0a01), checks the payout, marks the invoice used, and transfers fUSD.",
    who: "The agent key (linked authenticator, 24h expiry)",
    onChain: "pqcVerify pass, invoice marked paid, 0.010000 fUSD transferred",
    never: "Direct fUSD.transfer, wrong payee, replay, or paying over the cap",
    answer: "Inside the rules: settled once. Over the cap: queued for the owner.",
    icon: ShieldCheck,
    trace: [
      ["precompile", "pqcVerify 0x…0a01", "ok"],
      ["decisionCode", "OK_PAY", "ok"],
      ["txHash", "3DEB1D5B87…8B3F84", "ok"],
    ],
  },
  {
    n: "04",
    label: "Receipt signed",
    state: "Audit chain",
    title: "Every decision leaves an ML-DSA-signed, hash-chained receipt.",
    body: "Whether the clerk paid, queued, or refused an invoice, it hashes the canonical decision body with Keccak-256 and signs steward.receipt.v1 with its ML-DSA key. Anyone can verify the receipt in the browser.",
    who: "The agent’s receipt store; verified by anyone on /gate",
    onChain: "Confirmed txHash 3DEB1D5B87…8B3F84 referenced in receipt #0",
    never: "Altering a single character of the amount without breaking the signature",
    answer: "Hash matches. ML-DSA-87 signature checks in the browser.",
    icon: FileCheck2,
    trace: [
      ["seq", "#0 · prevHash 0x0000…0000", "dim"],
      ["bodyHash", "0xa3d3e6…9f5d", "ok"],
      ["txStatus", "confirmed · qorechain-diana", "ok"],
    ],
  },
];

function StepGraphic({ step, reduce }: { step: number; reduce: boolean }) {
  const nodes = [
    { x: 52, y: 84, label: "Owner", sub: "QoreSeal" },
    { x: 162, y: 84, label: "Vendor", sub: "ML-DSA-87" },
    { x: 274, y: 84, label: "PayGate", sub: "pqcVerify" },
    { x: 384, y: 84, label: "Receipt", sub: "0xa3d3…" },
  ];

  return (
    <svg viewBox="0 0 436 168" className="block w-full max-w-[440px] select-none" aria-hidden="true">
      {/* Connector tracks */}
      {[0, 1, 2].map((i) => {
        const a = nodes[i]!;
        const b = nodes[i + 1]!;
        const lit = i < step;
        const active = i === step - 1;
        return (
          <g key={i}>
            <line
              x1={a.x + 28}
              y1={a.y}
              x2={b.x - 28}
              y2={b.y}
              stroke="rgba(var(--ink-rgb), 0.16)"
              strokeWidth="1.5"
              strokeDasharray="3 4"
            />
            {lit ? (
              <motion.line
                key={`lit-${step}-${i}`}
                x1={a.x + 28}
                y1={a.y}
                x2={b.x - 28}
                y2={b.y}
                stroke="var(--color-brand)"
                strokeWidth="2"
                initial={reduce ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.65, ease: EASE }}
              />
            ) : null}
            {active && !reduce ? (
              <motion.circle
                key={`pkt-${step}-${i}`}
                cy={a.y}
                r="4"
                fill="var(--color-brand)"
                initial={{ cx: a.x + 28, opacity: 0.4 }}
                animate={{ cx: b.x - 28, opacity: 1 }}
                transition={{ duration: 0.85, ease: EASE }}
              />
            ) : null}
          </g>
        );
      })}

      {/* Step station nodes */}
      {nodes.map((node, i) => {
        const isCurrent = i === step;
        const isDone = i < step;
        return (
          <g key={node.label}>
            {isCurrent ? (
              <motion.rect
                x={node.x - 32}
                y={node.y - 32}
                width={64}
                height={64}
                rx={16}
                fill="none"
                stroke="var(--color-brand)"
                strokeOpacity={0.35}
                strokeWidth="1.5"
                initial={reduce ? false : { scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.4, ease: EASE }}
                style={{ transformBox: "fill-box", transformOrigin: "center" }}
              />
            ) : null}
            <rect
              x={node.x - 26}
              y={node.y - 26}
              width={52}
              height={52}
              rx={12}
              fill={
                isCurrent
                  ? "rgba(45, 212, 191, 0.16)"
                  : isDone
                    ? "rgba(52, 211, 153, 0.12)"
                    : "rgba(var(--ink-rgb), 0.04)"
              }
              stroke={
                isCurrent
                  ? "var(--color-brand)"
                  : isDone
                    ? "var(--color-paid)"
                    : "rgba(var(--ink-rgb), 0.18)"
              }
              strokeWidth="1.25"
            />
            <text
              x={node.x}
              y={node.y + 4}
              textAnchor="middle"
              className="font-mono text-[11px] font-semibold"
              fill={isCurrent ? "var(--color-brand)" : isDone ? "var(--color-paid)" : "var(--color-muted)"}
            >
              0{i + 1}
            </text>
            <text
              x={node.x}
              y={node.y + 44}
              textAnchor="middle"
              className="text-[11px] font-medium"
              fill={isCurrent || isDone ? "var(--color-ink)" : "var(--color-muted)"}
            >
              {node.label}
            </text>
            <text
              x={node.x}
              y={node.y + 58}
              textAnchor="middle"
              className="font-mono text-[9.5px]"
              fill="var(--color-muted)"
            >
              {node.sub}
            </text>
          </g>
        );
      })}

      {/* Top status bar */}
      <text x="218" y="24" textAnchor="middle" className="font-mono text-[10px]" fill="var(--color-muted)">
        {step === 0
          ? "OWNER REGISTERS VENDOR + SEALS MANDATE"
          : step === 1
            ? "VENDOR STAMPS INVOICE WITH ML-DSA-87"
            : step === 2
              ? "QORECHAIN RULE + PAYGATE VERIFY ON CHAIN"
              : "AGENT SIGNS HASH-CHAINED RECEIPT #0"}
      </text>
    </svg>
  );
}

export function HowSteward() {
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { amount: 0.25 });
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (reduce || !inView || paused) return;
    const id = window.setInterval(() => {
      setActive((prev) => (prev + 1) % STEPS.length);
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [reduce, inView, paused]);

  const current = STEPS[active]!;
  const ActiveIcon = current.icon;

  return (
    <section ref={ref} id="how" className="mx-auto max-w-[1040px] scroll-mt-20 py-16 md:py-20" aria-labelledby="how-heading">
      <div className="max-w-[660px]">
        <div className="inline-flex items-center gap-2 text-[13px] font-medium text-brand">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
          <span>How Steward works</span>
        </div>
        <h2 id="how-heading" className="mt-2 text-[30px] leading-[1.12] font-medium tracking-[-0.03em] sm:text-[38px]">
          From a vendor’s ML-DSA signature to a settled receipt.
        </h2>
        <p className="mt-3 text-[16px] text-muted">
          Four steps separate an incoming invoice from a payment on QoreChain. Every step leaves a cryptographic trace
          that does not depend on trusting the AI planner.
        </p>
      </div>

      {/* Step tabs */}
      <div
        role="tablist"
        aria-label="How Steward processes an invoice"
        className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {STEPS.map((s, idx) => {
          const Icon = s.icon;
          const on = idx === active;
          return (
            <button
              key={s.n}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActive(idx)}
              className={`relative flex min-h-12 items-center gap-2.5 overflow-hidden rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                on
                  ? "border-line-strong bg-surface text-ink"
                  : "border-line bg-surface/50 text-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${on ? "text-brand" : "text-muted"}`} />
              <span className="min-w-0 truncate text-[13px] font-medium">
                <span className="mr-1.5 font-mono text-[11px] text-muted">{s.n}</span>
                {s.label}
              </span>
              {on && !reduce && inView && !paused ? (
                <motion.span
                  key={`bar-${active}`}
                  aria-hidden="true"
                  className="absolute inset-x-3 bottom-0 h-[2px] origin-left rounded-full bg-brand"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: STEP_MS / 1000, ease: "linear" }}
                />
              ) : on ? (
                <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-brand" />
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Hatched stage holding the split card */}
      <div
        className="steward-stage mt-4 p-4 sm:p-7 md:p-9"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="mx-auto grid max-w-[960px] gap-6 rounded-[18px] border border-line-strong bg-surface/95 p-5 shadow-2xl shadow-black/40 sm:p-7 lg:grid-cols-2 lg:gap-8">
          {/* Left: Step narrative & structured facts */}
          <AnimatePresence mode="wait">
            <motion.div
              key={current.n}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="flex min-w-0 flex-col gap-3.5"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-brand/35 bg-brand-soft text-brand">
                  <ActiveIcon className="h-5 w-5" />
                </span>
                <p className="font-mono text-[12px] text-muted">
                  Step {current.n} of 04 · <span className="text-ink">{current.state}</span>
                </p>
              </div>

              <h3 className="text-[22px] leading-[1.2] font-medium tracking-[-0.025em] text-ink sm:text-[25px]">
                {current.title}
              </h3>
              <p className="text-[14.5px] leading-[1.6] text-muted">{current.body}</p>

              <dl className="mt-1 divide-y divide-line border-t border-line text-[13.5px]">
                <div className="grid gap-1 py-2.5 sm:grid-cols-[106px_1fr] sm:gap-3">
                  <dt className="text-[12px] text-muted">Who acts</dt>
                  <dd className="text-ink">{current.who}</dd>
                </div>
                <div className="grid gap-1 py-2.5 sm:grid-cols-[106px_1fr] sm:gap-3">
                  <dt className="text-[12px] text-muted">On QoreChain</dt>
                  <dd className="text-ink">{current.onChain}</dd>
                </div>
                <div className="grid gap-1 py-2.5 sm:grid-cols-[106px_1fr] sm:gap-3">
                  <dt className="text-[12px] text-muted">Cannot happen</dt>
                  <dd className="text-muted">{current.never}</dd>
                </div>
              </dl>
            </motion.div>
          </AnimatePresence>

          {/* Right: Animated schematic + real receipt/chain trace */}
          <div className="flex min-w-0 flex-col justify-between gap-5 rounded-2xl border border-line bg-canvas/75 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className="font-mono text-muted">Steward pipeline</span>
              <span className="rounded-full border border-brand/35 bg-brand-soft px-2.5 py-0.5 font-mono text-[11px] text-brand">
                {current.state}
              </span>
            </div>

            <div className="flex items-center justify-center py-1">
              <StepGraphic step={active} reduce={reduce} />
            </div>

            <div className="divide-y divide-line/80 rounded-xl border border-line bg-surface/80 px-3.5 py-1 font-mono text-[11.5px]">
              {current.trace.map(([k, v, tone]) => (
                <div key={k} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-muted">{k}</span>
                  <span className={`truncate ${tone === "ok" ? "text-paid" : "text-ink"}`}>
                    {tone === "ok" ? "✓ " : ""}
                    {v}
                  </span>
                </div>
              ))}
            </div>

            <p className="text-[14.5px] font-medium tracking-[-0.01em] text-ink">{current.answer}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
