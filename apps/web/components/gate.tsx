"use client";

import { useCallback, useEffect, useState } from "react";
import { Money } from "./ui";
import { GATE, VENDOR, shortAddress } from "@/lib/engine";
import { invoiceLabel, readGate, type GateLive } from "@/lib/live";
import { checkReceipt, checkTamperedReceipt } from "@/lib/receipt";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-3">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
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

  return (
    <main className="mx-auto max-w-[960px] px-5 pb-16">
      <h1 className="text-[34px] leading-[1.08] font-medium tracking-[-0.02em] md:text-[44px]">
        The <span className="word">gate</span>, live
      </h1>
      <p className="mt-3 max-w-[60ch] text-[16px] text-muted">
        Read from PayGate on qorechain-diana each time the page opens. Nothing here is cached or typed in.
      </p>

      <div className="mt-8 grid items-start gap-10 md:grid-cols-[1.2fr_1fr]">
        <section className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[20px] font-medium">PayGate</h2>
            <button type="button" className="min-h-11 text-[15px] text-brand disabled:text-muted" disabled={live.status === "loading"} onClick={load}>
              {live.status === "loading" ? "Reading" : "Read again"}
            </button>
          </div>
          {live.status === "error" ? (
            <p className="mt-3 text-[15px] text-refused">Couldn’t read the gate. The testnet RPC did not answer.</p>
          ) : null}
          <dl className="mt-2 text-[15px]" aria-busy={live.status === "loading"}>
            <Row label="Address">
              <span className="font-mono text-[13px]" title={GATE}>
                {shortAddress(GATE)}
              </span>
            </Row>
            <Row label="fUSD held">{gate ? <Money base={gate.balance} tone="paid" /> : <span className="text-muted">—</span>}</Row>
            <Row label="Paused">{gate ? (gate.paused ? <span className="text-refused">Yes</span> : "No") : <span className="text-muted">—</span>}</Row>
            <Row label="Spent today">{gate ? <Money base={gate.spentToday} /> : <span className="text-muted">—</span>}</Row>
            <Row label="Daily cap">{gate ? <Money base={gate.dailyCap} /> : <span className="text-muted">—</span>}</Row>
          </dl>

          <h2 className="mt-8 text-[20px] font-medium">The one vendor</h2>
          <dl className="mt-2 text-[15px]">
            <Row label="Vendor">
              <span className="font-mono text-[13px]" title={VENDOR}>
                {shortAddress(VENDOR)}
              </span>
            </Row>
            <Row label="Pays out to">
              {gate ? (
                gate.payout.toLowerCase() === VENDOR.toLowerCase() ? (
                  <span title={gate.payout}>Its own address</span>
                ) : (
                  <span className="font-mono text-[13px]" title={gate.payout}>
                    {shortAddress(gate.payout)}
                  </span>
                )
              ) : (
                <span className="text-muted">—</span>
              )}
            </Row>
            <Row label="Per-invoice cap">{gate ? <Money base={gate.perInvoiceCap} /> : <span className="text-muted">—</span>}</Row>
            <Row label="First invoice">{gate ? invoiceLabel(gate.invoiceState) : <span className="text-muted">—</span>}</Row>
          </dl>
          <p className="mt-3 text-[14px] text-muted">
            Adding a vendor, or changing a payout or a cap, needs the owner’s ML-DSA signature and waits a 60-second timelock.
          </p>
        </section>

        <section className="min-w-0 rounded-lg border border-line bg-surface p-5">
          <h2 className="text-[20px] font-medium">The agent’s receipt</h2>
          <p className="mt-2 text-[15px] text-muted">
            The agent signs a receipt for each decision with its ML-DSA key. This checks the first one in your browser: the
            hash of its body, and the signature. Change one character checks a copy. The file stays as it is.
          </p>
          <p
            className={`mt-4 text-[15px] ${receipt === "ok" ? "text-paid" : receipt === "tampered" || receipt === "error" ? "text-refused" : "text-muted"}`}
            aria-live="polite"
          >
            {receipt === "idle" ? "Not checked yet." : null}
            {receipt === "checking" ? "Checking the signature." : null}
            {receipt === "tampering" ? "Changing one character." : null}
            {receipt === "ok" ? "The hash matches and the ML-DSA signature checks." : null}
            {receipt === "tampered" || receipt === "error" ? receiptMessage : null}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            <button
              type="button"
              className="min-h-11 rounded-md bg-brand px-4 text-[15px] text-on-brand disabled:opacity-60"
              disabled={busy}
              onClick={verify}
            >
              {receipt === "tampered" ? "Check the real receipt" : receipt === "ok" || receipt === "error" ? "Check again" : "Check the receipt"}
            </button>
            <button type="button" className="min-h-11 text-[15px] text-brand disabled:text-muted" disabled={busy} onClick={tamper}>
              Change one character
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
