"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, CheckCircle2, Clock, Copy, PauseCircle, ShieldAlert } from "lucide-react";
import { LEDGER, type LedgerState } from "@/lib/ledger";

const stateConfig: Record<
  LedgerState,
  { badge: string; icon: typeof CheckCircle2; dot: string }
> = {
  paid: {
    badge: "border-paid/35 bg-paid-soft text-paid",
    icon: CheckCircle2,
    dot: "bg-paid",
  },
  refused: {
    badge: "border-refused/35 bg-refused-soft text-refused",
    icon: ShieldAlert,
    dot: "bg-refused",
  },
  queued: {
    badge: "border-queued/35 bg-queued-soft text-queued",
    icon: Clock,
    dot: "bg-queued",
  },
  paused: {
    badge: "border-line-strong bg-surface-elevated text-muted",
    icon: PauseCircle,
    dot: "bg-muted",
  },
};

function Hash({ label, hash }: { label: string; hash: string }) {
  const [copied, setCopied] = useState(false);
  const short = `${hash.slice(0, 10)}…${hash.slice(-6)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <li className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-line bg-canvas/75 px-3 py-1.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="w-14 shrink-0 text-[12px] font-medium text-muted">{label}</span>
        <code className="min-w-0 truncate font-mono text-[12px] text-ink" title={hash}>
          {short}
        </code>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy the ${label.toLowerCase()} hash`}
        className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-muted transition-colors hover:bg-surface hover:text-ink"
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-paid" />
            <span className="text-paid">Copied</span>
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5 opacity-70" />
            <span>Copy</span>
          </>
        )}
      </button>
    </li>
  );
}

export function Ledger() {
  return (
    <ol className="space-y-3">
      {LEDGER.map((row, index) => {
        const cfg = stateConfig[row.state];
        const StateIcon = cfg.icon;
        return (
          <motion.li
            key={row.step}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-30px" }}
            transition={{ duration: 0.35, delay: index * 0.04 }}
            className="group grid gap-4 rounded-xl border border-line bg-surface/90 p-4 transition-colors hover:border-line-strong sm:p-5 md:grid-cols-[2.75rem_1fr_19.5rem] md:items-start md:gap-5"
          >
            <div className="flex items-center gap-3 md:flex-col md:items-center md:gap-2">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-canvas font-mono text-[13px] font-medium text-ink">
                {String(row.step).padStart(2, "0")}
              </span>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium md:hidden ${cfg.badge}`}>
                <StateIcon className="h-3.5 w-3.5" />
                {row.stateLabel}
              </span>
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <p className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{row.title}</p>
                <span className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium md:inline-flex ${cfg.badge}`}>
                  <StateIcon className="h-3.5 w-3.5" />
                  {row.stateLabel}
                </span>
              </div>
              <p className="mt-1.5 max-w-[56ch] text-[14px] leading-relaxed text-muted">{row.detail}</p>
              <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas/60 px-2 py-0.5 font-mono text-[11px] text-muted">
                <span>Layer:</span>
                <span className="text-ink">{row.layer}</span>
              </div>
            </div>

            <ul className="min-w-0 space-y-2 self-start">
              {row.hashes.map((item) => (
                <Hash key={item.hash} label={item.label} hash={item.hash} />
              ))}
            </ul>
          </motion.li>
        );
      })}
    </ol>
  );
}
