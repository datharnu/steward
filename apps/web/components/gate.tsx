"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Fingerprint,
  FlaskConical,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { CopyChip, Money } from "./ui";
import { WorkspaceShell } from "./workspace-shell";
import { GATE, VENDOR, shortAddress } from "@/lib/engine";
import { invoiceLabel, readGate, type GateLive } from "@/lib/live";
import { checkReceipt, checkTamperedReceipt } from "@/lib/receipt";
import { PayCheck } from "./pay-check";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line/80 py-2.5 last:border-b-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[13.5px] font-medium text-ink">{children}</dd>
    </div>
  );
}

export function GatePanel() {
  const [live, setLive] = useState<{ status: "loading" | "error" | "ready"; gate?: GateLive }>({ status: "loading" });
  const [receipt, setReceipt] = useState<"idle" | "checking" | "ok" | "tampering" | "tampered" | "error">("idle");
  const [receiptMessage, setReceiptMessage] = useState("");

  const load = useCallback(() => {
    setLive({ status: "loading" });
    readGate()
      .then((gate) => setLive({ status: "ready", gate }))
      .catch(() => setLive({ status: "error" }));
  }, []);

  const busy = receipt === "checking" || receipt === "tampering";

  const verify = useCallback(() => {
    setReceipt("checking");
    setReceiptMessage("");
    checkReceipt()
      .then(() => setReceipt("ok"))
      .catch((error: unknown) => {
        setReceipt("error");
        setReceiptMessage(error instanceof Error ? error.message : "The check failed.");
      });
  }, []);

  const tamper = useCallback(() => {
    setReceipt("tampering");
    setReceiptMessage("");
    checkTamperedReceipt()
      .then((message) => {
        setReceipt("tampered");
        setReceiptMessage(message);
      })
      .catch((error: unknown) => {
        setReceipt("error");
        setReceiptMessage(error instanceof Error ? error.message : "The check failed.");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const gate = live.status === "ready" ? live.gate : undefined;

  const receiptSteps = [
    {
      label: "Load /receipt.json",
      state:
        receipt === "idle"
          ? "idle"
          : receipt === "checking" || receipt === "tampering"
            ? "active"
            : "pass",
    },
    {
      label:
        receipt === "tampered" || receipt === "tampering"
          ? "Mutate amount & hash (Keccak-256)"
          : "Recompute Keccak-256 body hash",
      state:
        receipt === "idle"
          ? "idle"
          : receipt === "checking" || receipt === "tampering"
            ? "active"
            : "pass",
    },
    {
      label: "Verify ML-DSA-87 signature",
      state:
        receipt === "idle"
          ? "idle"
          : receipt === "checking" || receipt === "tampering"
            ? "active"
            : receipt === "ok"
              ? "pass"
              : "fail",
    },
  ] as const;

  const sidebar = (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-[11px] tracking-wider text-muted uppercase">Live vault readout</p>
        <div className="mt-2 rounded-xl border border-line bg-canvas/75 p-3.5">
          <div className="flex items-center justify-between gap-2 text-[12px] text-muted">
            <span>fUSD held</span>
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  gate ? "bg-paid" : live.status === "error" ? "bg-refused" : "animate-pulse bg-brand"
                }`}
              />
              {gate ? "Live" : live.status === "error" ? "Offline" : "Syncing"}
            </span>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            {gate ? (
              <>
                <Money base={gate.balance} tone="paid" className="text-[24px] font-semibold tracking-[-0.02em]" />
                <span className="font-mono text-[12px] text-muted">fUSD</span>
              </>
            ) : live.status === "error" ? (
              <span className="text-[15px] font-medium text-refused">Unavailable</span>
            ) : (
              <span className="inline-block h-7 w-32 animate-pulse rounded-md bg-surface-elevated" />
            )}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="font-mono text-[11px] tracking-wider text-muted uppercase">Contract checks</p>
        <div className="flex items-center justify-between rounded-lg border border-line bg-canvas/55 px-3 py-2 text-[12.5px]">
          <span className="text-muted">Gate state</span>
          {gate ? (
            gate.paused ? (
              <span className="font-medium text-refused">Paused</span>
            ) : (
              <span className="font-medium text-paid">Open</span>
            )
          ) : (
            <span className="text-muted">—</span>
          )}
        </div>
        <div className="flex items-center justify-between rounded-lg border border-line bg-canvas/55 px-3 py-2 text-[12.5px]">
          <span className="text-muted">First invoice</span>
          <span className="font-mono text-[12px] text-ink">{gate ? invoiceLabel(gate.invoiceState) : "—"}</span>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-line bg-canvas/55 px-3 py-2 text-[12.5px]">
          <span className="text-muted">Per-invoice cap</span>
          <span className="font-mono text-[12px] text-ink">
            {gate ? <Money base={gate.perInvoiceCap} /> : "—"}
          </span>
        </div>
      </div>

      <div className="mt-1 space-y-2 border-t border-line pt-4">
        <p className="font-mono text-[11px] tracking-wider text-muted uppercase">Quick actions</p>
        <Link
          href="/try"
          className="flex items-center justify-between rounded-lg border border-line bg-canvas/60 px-3 py-2 text-[13px] font-medium text-ink transition-colors hover:border-brand/50 hover:text-brand"
        >
          <span>Test attacks in sandbox</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        <Link
          href="/vendor"
          className="flex items-center justify-between rounded-lg border border-line bg-canvas/60 px-3 py-2 text-[13px] font-medium text-ink transition-colors hover:border-brand/50 hover:text-brand"
        >
          <span>Sign a test invoice</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );

  const inspector = (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-brand/35 bg-brand-soft text-brand">
          <Fingerprint className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-[16px] font-semibold text-ink">The agent’s receipt</h2>
          <p className="font-mono text-[11px] text-muted">Client-side ML-DSA-87 verifier</p>
        </div>
      </div>

      <p className="text-[13px] leading-relaxed text-muted">
        The agent signs a receipt for each decision with its ML-DSA key. This checks the first one in your browser: the
        hash of its body, and the signature. Change one character checks a copy. The file stays as it is.
      </p>

      {/* 3-step verification pipeline */}
      <div className="space-y-2 rounded-xl border border-line bg-canvas/70 p-3">
        {receiptSteps.map((step, idx) => (
          <div key={step.label} className="flex items-center gap-2.5 text-[12.5px]">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
              {step.state === "active" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
              ) : step.state === "pass" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-paid" />
              ) : step.state === "fail" ? (
                <ShieldAlert className="h-3.5 w-3.5 text-refused" />
              ) : (
                <span className="font-mono text-[11px] text-muted">{idx + 1}</span>
              )}
            </span>
            <span
              className={
                step.state === "pass"
                  ? "text-ink"
                  : step.state === "fail"
                    ? "font-medium text-refused"
                    : step.state === "active"
                      ? "text-brand"
                      : "text-muted"
              }
            >
              {step.label}
            </span>
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={receipt}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className={`rounded-xl border p-3 text-[13px] ${
            receipt === "ok"
              ? "border-paid/35 bg-paid-soft text-paid"
              : receipt === "tampered" || receipt === "error"
                ? "border-refused/35 bg-refused-soft text-refused"
                : "border-line bg-canvas/50 text-muted"
          }`}
          aria-live="polite"
        >
          {receipt === "idle" ? "Not checked yet." : null}
          {receipt === "checking" ? "Checking the signature." : null}
          {receipt === "tampering" ? "Changing one character." : null}
          {receipt === "ok" ? "The hash matches and the ML-DSA signature checks." : null}
          {receipt === "tampered" || receipt === "error" ? receiptMessage : null}
        </motion.div>
      </AnimatePresence>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 text-[13.5px] font-medium text-on-brand shadow-xs transition-all hover:brightness-110 disabled:opacity-60 active:scale-[0.98]"
          disabled={busy}
          onClick={verify}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          <span>
            {receipt === "tampered"
              ? "Check the real receipt"
              : receipt === "ok" || receipt === "error"
                ? "Check again"
                : "Check the receipt"}
          </span>
        </button>
        <button
          type="button"
          className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-canvas/80 px-4 text-[13.5px] font-medium text-ink transition-all hover:border-refused/50 hover:text-refused disabled:opacity-50 active:scale-[0.98]"
          disabled={busy}
          onClick={tamper}
        >
          <FlaskConical className="h-3.5 w-3.5" />
          <span>Change one character</span>
        </button>
      </div>

      {/* Receipt metadata */}
      <div className="border-t border-line pt-3 font-mono text-[11.5px]">
        <p className="mb-2 text-[10.5px] tracking-wider text-muted uppercase">Receipt #0 · public/receipt.json</p>
        <div className="space-y-1.5 text-muted">
          <div className="flex justify-between gap-2">
            <span>bodyHash</span>
            <span className="text-ink">0xa3d3e6…9f5d</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>invoiceKey</span>
            <span className="text-ink">0xfb17c7…75a3</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>txHash</span>
            <span className="text-ink">3DEB1D5B87…8B3F84</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>txStatus</span>
            <span className="text-paid">confirmed</span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <WorkspaceShell
      title={
        <>
          The <span className="word">gate</span>, live
        </>
      }
      badge="Live RPC"
      subtitle="Read directly from PayGate on qorechain-diana. Nothing here is cached or typed in."
      actions={
        <button
          type="button"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface-elevated px-3.5 text-[13px] font-medium text-ink transition-all hover:border-brand/60 disabled:opacity-60 active:scale-[0.98]"
          disabled={live.status === "loading"}
          onClick={load}
        >
          <RefreshCw className={`h-3.5 w-3.5 text-brand ${live.status === "loading" ? "animate-spin" : ""}`} />
          <span>{live.status === "loading" ? "Reading" : "Read again"}</span>
        </button>
      }
      toolbarLeft={
        <>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-ink">
            <Lock className="h-3 w-3 text-brand" />
            EVM 9800
          </span>
          <span>qorechain-diana · fUSD</span>
          {gate ? (
            <span className={`font-medium ${gate.paused ? "text-refused" : "text-paid"}`}>
              · {gate.paused ? "Paused" : "Gate open"}
            </span>
          ) : null}
        </>
      }
      toolbarRight={<CopyChip value={GATE} display={shortAddress(GATE)} label="PayGate address" />}
      sidebar={sidebar}
      inspector={inspector}
    >
      <div className="space-y-5">
        <PayCheck />
        {live.status === "error" ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-refused/40 bg-refused-soft px-4 py-3 text-[13.5px] text-refused">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <p>Couldn’t read the gate. The testnet RPC did not answer.</p>
          </div>
        ) : null}

        {/* Wired Live Node Cards on the dotted canvas (matches homepage preview craft) */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-line-strong bg-surface p-3.5 shadow-sm">
            <div className="flex items-center justify-between border-b border-line pb-2 text-[11.5px]">
              <span className="font-mono text-muted">01 · PayGate</span>
              <span className="text-paid">
                <Check className="h-3.5 w-3.5" />
              </span>
            </div>
            <p className="mt-2.5 text-[13px] font-semibold text-ink">fUSD held</p>
            <p className="mt-0.5 text-[18px] font-semibold">
              {gate ? <Money base={gate.balance} tone="paid" /> : <span className="text-muted">—</span>}
            </p>
            <p className="mt-2 border-t border-line pt-2 font-mono text-[11px] text-muted">{shortAddress(GATE)}</p>
          </div>

          <div className="rounded-xl border border-line-strong bg-surface p-3.5 shadow-sm">
            <div className="flex items-center justify-between border-b border-line pb-2 text-[11.5px]">
              <span className="font-mono text-muted">02 · Vendor</span>
              <span className="text-paid">
                <Check className="h-3.5 w-3.5" />
              </span>
            </div>
            <p className="mt-2.5 text-[13px] font-semibold text-ink">Per-invoice cap</p>
            <p className="mt-0.5 text-[18px] font-semibold">
              {gate ? <Money base={gate.perInvoiceCap} /> : <span className="text-muted">—</span>}
            </p>
            <p className="mt-2 border-t border-line pt-2 font-mono text-[11px] text-muted">{shortAddress(VENDOR)}</p>
          </div>

          <div className="rounded-xl border border-line-strong bg-surface p-3.5 shadow-sm">
            <div className="flex items-center justify-between border-b border-line pb-2 text-[11.5px]">
              <span className="font-mono text-muted">03 · Invoice #1</span>
              <span className="text-paid">
                <Check className="h-3.5 w-3.5" />
              </span>
            </div>
            <p className="mt-2.5 text-[13px] font-semibold text-ink">On-chain state</p>
            <p className="mt-0.5 text-[18px] font-semibold text-paid">
              {gate ? invoiceLabel(gate.invoiceState) : <span className="text-muted">—</span>}
            </p>
            <p className="mt-2 border-t border-line pt-2 font-mono text-[11px] text-muted">0xfb17c7…75a3</p>
          </div>
        </div>

        {/* Full PayGate & Vendor Readouts */}
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
            <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
              <h2 className="text-[15px] font-semibold text-ink">PayGate</h2>
              <CopyChip value={GATE} display={shortAddress(GATE)} label="PayGate address" />
            </div>
            <dl className="mt-1" aria-busy={live.status === "loading"}>
              <Row label="Address">
                <span className="font-mono text-[12.5px]" title={GATE}>
                  {shortAddress(GATE)}
                </span>
              </Row>
              <Row label="fUSD held">
                {gate ? <Money base={gate.balance} tone="paid" /> : <span className="text-muted">—</span>}
              </Row>
              <Row label="Paused">
                {gate ? (gate.paused ? <span className="text-refused">Yes</span> : "No") : <span className="text-muted">—</span>}
              </Row>
              <Row label="Spent today">
                {gate ? <Money base={gate.spentToday} /> : <span className="text-muted">—</span>}
              </Row>
              <Row label="Daily cap">
                {gate ? <Money base={gate.dailyCap} /> : <span className="text-muted">—</span>}
              </Row>
            </dl>
          </section>

          <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
            <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-vendor" />
                <h2 className="text-[15px] font-semibold text-ink">The one vendor</h2>
              </div>
              <CopyChip value={VENDOR} display={shortAddress(VENDOR)} label="vendor address" />
            </div>
            <dl className="mt-1">
              <Row label="Vendor">
                <span className="font-mono text-[12.5px]" title={VENDOR}>
                  {shortAddress(VENDOR)}
                </span>
              </Row>
              <Row label="Pays out to">
                {gate ? (
                  gate.payout.toLowerCase() === VENDOR.toLowerCase() ? (
                    <span title={gate.payout}>Its own address</span>
                  ) : (
                    <span className="font-mono text-[12.5px]" title={gate.payout}>
                      {shortAddress(gate.payout)}
                    </span>
                  )
                ) : (
                  <span className="text-muted">—</span>
                )}
              </Row>
              <Row label="Per-invoice cap">
                {gate ? <Money base={gate.perInvoiceCap} /> : <span className="text-muted">—</span>}
              </Row>
              <Row label="First invoice">
                {gate ? (
                  <span className="rounded-full border border-paid/35 bg-paid-soft px-2 py-0.5 font-mono text-[11.5px] text-paid">
                    {invoiceLabel(gate.invoiceState)}
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </Row>
            </dl>
          </section>
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-line-strong bg-surface/75 px-4 py-3 text-[12.5px] text-muted">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <p className="m-0">
            Adding a vendor, or changing a payout or a cap, needs the owner’s ML-DSA signature and waits a 60-second
            timelock.
          </p>
        </div>
      </div>
    </WorkspaceShell>
  );
}
