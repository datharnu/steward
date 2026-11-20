"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { formatFusd } from "@/lib/engine";

const tone = {
  paid: "text-paid",
  queued: "text-queued",
  refused: "text-refused",
  empty: "text-ink",
} as const;

export function Money({
  base,
  tone: kind = "empty",
  className = "",
}: {
  base: bigint;
  tone?: keyof typeof tone;
  className?: string;
}) {
  return (
    <span className={`font-mono tabular-nums ${tone[kind]} ${className}`} title={`${base.toString()} base units`}>
      {formatFusd(base)}
    </span>
  );
}

export function CopyChip({
  value,
  display,
  label = "Copy",
  ariaLabel,
  className = "",
}: {
  value: string;
  display?: string;
  label?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={ariaLabel ?? `Copy ${label}`}
      title={value}
      className={`group inline-flex min-h-8 items-center gap-1.5 rounded-md border border-line bg-canvas/80 px-2.5 py-1 font-mono text-[12px] text-muted transition-all hover:border-line-strong hover:text-ink active:scale-[0.98] ${className}`}
    >
      <span className="truncate">{display ?? value}</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-paid" />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}
