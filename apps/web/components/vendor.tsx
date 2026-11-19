"use client";

import { useState } from "react";
import { VENDOR, shortAddress } from "@/lib/engine";
import { signInvoiceInBrowser, type SignedInvoiceFile } from "@/lib/invoice";

type Status = "idle" | "signing" | "ready" | "error";

export function VendorSign() {
  const [payee, setPayee] = useState(VENDOR);
  const [memo, setMemo] = useState("Browser invoice");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [file, setFile] = useState<SignedInvoiceFile | null>(null);

  async function sign() {
    setStatus("signing");
    setError("");
    setFile(null);
    try {
      const signed = await signInvoiceInBrowser({ payee: payee.trim(), amount: 1000n, memo });
      setFile(signed);
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "The signature failed.");
    }
  }

  function download() {
    if (!file) return;
    const blob = new Blob([`${JSON.stringify(file, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "invoice.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="mt-10 max-w-[640px] rounded-lg border border-line bg-surface p-5">
      <h2 className="text-[20px] font-medium">Try step 3 in this tab</h2>
      <p className="mt-2 max-w-[62ch] text-[15px] text-muted">
        {status === "idle" ? "No key in this tab. A new ML-DSA key is made when you sign, and it is not saved." : null}
        {status === "signing" ? "Signing." : null}
        {status === "ready" ? (
          <span className="text-paid">Signed, and the signature checks. This key is not registered, so PayGate would refuse the file.</span>
        ) : null}
        {status === "error" ? <span className="text-refused">{error}</span> : null}
      </p>
      <label className="mt-4 block text-[14px] text-muted" htmlFor="payout">
        Payout address
      </label>
      <input
        id="payout"
        value={payee}
        onChange={(event) => setPayee(event.target.value)}
        spellCheck={false}
        className="mt-1 w-full min-w-0 rounded-md border border-line bg-canvas px-3 py-2 font-mono text-[13px] text-ink"
      />
      <label className="mt-3 block text-[14px] text-muted" htmlFor="vendor-memo">
        Memo
      </label>
      <input
        id="vendor-memo"
        value={memo}
        onChange={(event) => setMemo(event.target.value)}
        className="mt-1 w-full min-w-0 rounded-md border border-line bg-canvas px-3 py-2 text-[15px] text-ink"
      />
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <button
          type="button"
          className="min-h-11 rounded-md bg-brand px-4 text-[15px] text-on-brand disabled:opacity-60"
          disabled={status === "signing"}
          onClick={sign}
        >
          {status === "signing" ? "Signing" : status === "ready" ? "Sign another" : "Sign an invoice"}
        </button>
        {file ? (
          <button type="button" className="min-h-11 text-[15px] text-ink" onClick={download}>
            Download invoice.json
          </button>
        ) : null}
      </div>
      {file ? (
        <p className="mt-3 truncate font-mono text-[12px] text-muted" title={file.publicKey}>
          Public key {shortAddress(file.publicKey)}
        </p>
      ) : null}
    </section>
  );
}
