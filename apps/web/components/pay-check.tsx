"use client";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { checkRecordedPay, payFailed, type PayLine } from "@/lib/pay-check";

export function PayCheck() {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [lines, setLines] = useState<PayLine[]>([]);
  const [message, setMessage] = useState("");

  function run() {
    setStatus("loading");
    setMessage("");
    checkRecordedPay()
      .then((next) => {
        setLines(next);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        setStatus("error");
        setLines([]);
        setMessage(error instanceof Error ? error.message : "The check failed.");
      });
  }

  const failed = status === "ready" && payFailed(lines);

  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">The payment on chain</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            This reads the recorded pay and checks it in PayGate’s order. The signature comes after the token, the
            amount, the vendor, the payee, and the unused id. The caps come after the signature.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-[13.5px] font-medium text-on-brand shadow-xs transition-all hover:brightness-110 disabled:opacity-60 active:scale-[0.98]"
          disabled={status === "loading"}
          onClick={run}
        >
          {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          <span>{status === "idle" ? "Check this payment" : status === "loading" ? "Reading the payment" : "Check again"}</span>
        </button>
      </div>

      {status === "idle" ? <p className="mt-3 text-[13px] text-muted">The recorded pay has not been checked.</p> : null}
      {status === "loading" ? (
        <p className="mt-3 text-[13px] text-muted" aria-live="polite">
          Reading the payment.
        </p>
      ) : null}
      {status === "error" ? (
        <p className="mt-3 text-[13px] text-refused" role="alert">
          {message}
        </p>
      ) : null}
      {status === "ready" ? (
        <ol className="mt-3 space-y-2" aria-live="polite">
          {lines.map((line, index) => (
            <li key={line.label} className="min-w-0 rounded-lg border border-line bg-canvas/60 px-3 py-2">
              <p className="text-[13px] text-ink">
                <span className="font-mono text-[11px] text-muted">{index + 1}</span>{" "}
                <span className="font-medium">{line.label}</span>
                <span
                  className={
                    line.state === "fail" ? "text-refused" : line.state === "pass" ? "text-paid" : "text-muted"
                  }
                >
                  {" "}
                  {line.state === "pass" ? "Pass" : line.state === "fail" ? "Fail" : line.label === "Invoice id" ? "Paid now" : "After the signature"}
                </span>
              </p>
              <p className={`mt-1 text-[12.5px] break-all ${failed && line.state === "fail" ? "text-refused" : "text-muted"}`}>
                {line.detail}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
