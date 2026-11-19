"use client";

import { useState } from "react";
import { LEDGER, type LedgerState } from "@/lib/ledger";

const stateTone: Record<LedgerState, string> = {
  paid: "text-paid",
  refused: "text-refused",
  queued: "text-queued",
  paused: "text-muted",
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
    <li className="flex min-w-0 items-center gap-2">
      <span className="w-16 shrink-0 text-[13px] text-muted">{label}</span>
      <code className="min-w-0 truncate font-mono text-[13px]" title={hash}>
        {short}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy the ${label.toLowerCase()} hash`}
        className="min-h-11 shrink-0 px-2 text-[13px] text-muted hover:text-ink"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </li>
  );
}

export function Ledger() {
  return (
    <ol className="border-t border-line">
      {LEDGER.map((row) => (
        <li key={row.step} className="grid gap-3 border-b border-line py-5 md:grid-cols-[2.5rem_1fr_18.5rem] md:gap-6">
          <span className="font-mono text-[13px] text-muted">{String(row.step).padStart(2, "0")}</span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[17px] font-medium">{row.title}</span>
              <span className={`text-[14px] ${stateTone[row.state]}`}>{row.stateLabel}</span>
            </p>
            <p className="mt-1 max-w-[56ch] text-[15px] text-muted">{row.detail}</p>
            <p className="mt-1 text-[13px] text-muted">Layer: {row.layer}</p>
          </div>
          <ul className="min-w-0 self-start">
            {row.hashes.map((item) => (
              <Hash key={item.hash} label={item.label} hash={item.hash} />
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
