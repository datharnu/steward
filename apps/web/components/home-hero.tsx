"use client";

import Link from "next/link";
import { motion, useReducedMotion, type Transition } from "framer-motion";
import { ArrowRight, Bot, Cpu, FileKey2, Lock, Radio, ShieldCheck } from "lucide-react";
import { StewardMark } from "./brand-mark";
import { StewardPreview } from "./steward-preview";

const EASE_APPEAR = [0.12, 0.23, 0.5, 1] as const;

const PILLARS = [
  {
    where: "On chain",
    enforced: true,
    icon: Lock,
    title: "Chain rule",
    body: "The agent key may call pay and queue on PayGate. It cannot call the fUSD token or send coins.",
  },
  {
    where: "On chain",
    enforced: true,
    icon: ShieldCheck,
    title: "PayGate",
    body: "Verifies the vendor’s ML-DSA-87 signature on chain, checks the registered payout, and enforces caps.",
  },
  {
    where: "On the agent",
    enforced: false,
    icon: FileKey2,
    title: "Mandate",
    body: "The owner’s signed budget and vendor list, sealed to the agent. A stolen machine can skip this.",
  },
  {
    where: "On the agent",
    enforced: false,
    icon: Cpu,
    title: "Policy",
    body: "Clamps the planner to the mandate before a transaction exists. A stolen machine can skip this too.",
  },
];

const H1_WORDS = [
  { text: "An", tone: "strong" },
  { text: "AI", tone: "strong" },
  { text: "clerk", tone: "strong" },
  { text: "pays", tone: "strong" },
  { text: "your", tone: "strong" },
  { text: "invoices.", tone: "strong", breakAfter: true },
  { text: "It", tone: "soft" },
  { text: "cannot", tone: "soft" },
  { text: "be", tone: "soft" },
  { text: "talked", tone: "soft" },
  { text: "into", tone: "soft" },
  { text: "paying", tone: "soft" },
  { text: "anyone", tone: "accent" },
  { text: "else.", tone: "soft" },
];

export function HomeHero() {
  const reduce = useReducedMotion() ?? false;

  return (
    <header className="relative mx-auto flex max-w-[960px] flex-col items-start gap-12 pt-10 pb-8 md:gap-14 md:pt-14">
      {/* Heading column */}
      <div className="flex w-full max-w-[740px] flex-col items-start gap-6">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE_APPEAR }}
          className="inline-flex items-center gap-2.5 text-[13px] font-medium text-muted"
        >
          <span className="h-2 w-3.5 rounded-full bg-brand" aria-hidden="true" />
          <span>Built on QoreChain</span>
          <span className="text-line-strong">·</span>
          <span className="font-mono text-[12px] text-ink">qorechain-diana · ML-DSA-87</span>
        </motion.div>

        <h1
          aria-label="An AI clerk pays your invoices. It cannot be talked into paying anyone else."
          className="text-[36px] leading-[1.08] font-medium tracking-[-0.035em] text-balance sm:text-[48px] md:text-[54px]"
        >
          {H1_WORDS.map((w, i) => {
            const transition: Transition = {
              type: "tween",
              ease: EASE_APPEAR,
              duration: 0.72,
              delay: 0.08 + i * 0.035,
            };
            const cls =
              w.tone === "accent"
                ? "word font-normal"
                : w.tone === "soft"
                  ? "text-ink/60"
                  : "text-ink";
            return (
              <span key={i} aria-hidden="true">
                <motion.span
                  className={`inline-block ${cls}`}
                  initial={reduce ? false : { opacity: 0, y: 26, filter: "blur(8px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={transition}
                >
                  {w.text}
                </motion.span>
                {i < H1_WORDS.length - 1 ? " " : null}
                {w.breakAfter ? <br className="hidden lg:inline" /> : null}
              </span>
            );
          })}
        </h1>

        <motion.p
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.28, ease: EASE_APPEAR }}
          className="max-w-[60ch] text-[16px] leading-[1.6] text-muted sm:text-[17px]"
        >
          Even if the planner is fully prompt-injected, the only payment QoreChain allows is an invoice signed with the
          vendor’s ML-DSA-87 key, to the payout the owner approved, once, within the caps. This proves who was paid and
          that the vendor signed — not that the work was done.
        </motion.p>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.4, ease: EASE_APPEAR }}
          className="flex flex-wrap items-center gap-3 pt-1"
        >
          <Link
            href="/jailbreak"
            className="group inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-5 text-[15px] font-medium text-on-brand shadow-xs transition-all hover:brightness-110 active:scale-[0.98]"
          >
            <Bot className="h-4 w-4" />
            <span>Jailbreak the real AI clerk</span>
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/try"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-surface/90 px-5 text-[15px] font-medium text-ink transition-all hover:border-brand/50 hover:bg-surface-elevated active:scale-[0.98]"
          >
            <span>Try to break it</span>
          </Link>
          <Link
            href="/gate"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-surface/90 px-5 text-[15px] font-medium text-ink transition-all hover:border-brand/50 hover:bg-surface-elevated active:scale-[0.98]"
          >
            <Radio className="h-4 w-4 text-paid" />
            <span>Read the gate live</span>
          </Link>
        </motion.div>
      </div>

      {/* Live testnet strip + Framed product preview */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 26 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.0, delay: 0.48, ease: EASE_APPEAR }}
        className="flex w-full flex-col gap-4"
      >
        <div className="flex items-start gap-3.5 sm:items-center">
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px]"
            aria-hidden="true"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-brand-soft text-ink">
              <StewardMark size={14} />
            </span>
            <span className="text-muted">×</span>
            <span className="font-mono text-[11px] font-medium text-ink">Qore</span>
          </span>
          <p className="text-[14px] leading-snug text-muted">
            <span className="font-medium text-ink">Recorded on qorechain-diana</span> — The agent key called{" "}
            <code className="rounded bg-surface-elevated px-1.5 py-0.5 font-mono text-[12px] text-ink">
              fUSD.transfer
            </code>{" "}
            directly and the chain refused it (<span className="font-mono text-[12px] text-ink">92854431F2…028789</span>
            ).{" "}
            <Link href="/gate" className="text-ink underline decoration-line-strong underline-offset-3 hover:decoration-ink">
              Verify the ML-DSA receipt
            </Link>{" "}
            in your browser with no account.
          </p>
        </div>

        <Link
          href="/gate"
          aria-label="Open the live PayGate reader and in-browser ML-DSA receipt verifier"
          className="group relative block w-full rounded-[10px] transition-transform duration-300 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
        >
          <StewardPreview />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-2.5 left-2.5 z-10 rounded-full border border-line-strong bg-canvas/85 px-2.5 py-0.5 font-mono text-[11px] text-ink backdrop-blur-sm sm:hidden"
          >
            qorechain-diana · PayGate
          </span>
        </Link>
      </motion.div>

      {/* Four unboxed editorial pillars */}
      <div className="grid w-full gap-8 border-t border-line pt-9 sm:grid-cols-2 lg:grid-cols-4 lg:gap-9">
        {PILLARS.map((pillar, i) => {
          const Icon = pillar.icon;
          return (
            <motion.div
              key={pillar.title}
              initial={reduce ? false : { opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.75, delay: i * 0.08, ease: EASE_APPEAR }}
              className="flex flex-col items-start gap-2.5"
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border ${
                    pillar.enforced
                      ? "border-brand/35 bg-brand-soft text-brand"
                      : "border-line bg-surface text-muted"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span
                  className={`font-mono text-[11px] ${
                    pillar.enforced ? "text-brand" : "text-muted"
                  }`}
                >
                  {pillar.where}
                </span>
              </div>
              <h2 className="mt-1 text-[16px] font-semibold tracking-[-0.015em] text-ink">{pillar.title}</h2>
              <p className="text-[14px] leading-[1.55] text-muted">{pillar.body}</p>
            </motion.div>
          );
        })}
      </div>
    </header>
  );
}
