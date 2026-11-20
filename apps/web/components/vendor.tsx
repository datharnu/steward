"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  Download,
  FileCode2,
  FileSignature,
  KeyRound,
  Loader2,
  Lock,
  ShieldAlert,
  UserPlus,
} from "lucide-react";
import { CopyChip } from "./ui";
import { WorkspaceShell } from "./workspace-shell";
import { GATE, VENDOR, shortAddress } from "@/lib/engine";
import { signInvoiceInBrowser, type SignedInvoiceFile } from "@/lib/invoice";

type Status = "idle" | "signing" | "ready" | "error";

const STEPS = [
  {
    num: "01",
    icon: KeyRound,
    title: "Register a key",
    body: "The vendor’s ML-DSA key goes on chain with proof of possession. That is a transaction.",
    tag: "CLI",
  },
  {
    num: "02",
    icon: UserPlus,
    title: "The owner adds you",
    body: "Your payout and cap, signed by the owner, after a 60-second timelock.",
    tag: "60s timelock",
  },
  {
    num: "03",
    icon: FileSignature,
    title: "Sign invoices",
    body: "Each one names you, the payout, the amount, and an id that can only be paid once.",
    tag: "This tab",
    active: true,
  },
];

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

  const sidebar = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] tracking-wider text-muted uppercase">Vendor onboarding</p>
        <span className="rounded-full bg-surface-elevated px-2 py-0.5 font-mono text-[10.5px] text-muted">3 steps</span>
      </div>
      <ol className="space-y-2">
        {STEPS.map((step) => {
          const Icon = step.icon;
          return (
            <li
              key={step.num}
              className={`rounded-xl border p-3 ${
                step.active
                  ? "border-brand/45 bg-surface-elevated"
                  : "border-line bg-canvas/50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-md font-mono text-[11px] font-medium ${
                      step.active ? "bg-brand text-on-brand" : "border border-line bg-surface text-muted"
                    }`}
                  >
                    {step.num}
                  </span>
                  <span className="text-[13px] font-semibold text-ink">{step.title}</span>
                </div>
                <Icon className={`h-3.5 w-3.5 ${step.active ? "text-brand" : "text-muted"}`} />
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{step.body}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );

  const inspector = (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-vendor/35 bg-vendor/10 text-vendor">
          <FileCode2 className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-[15.5px] font-semibold text-ink">Signed envelope</h2>
          <p className="font-mono text-[11px] text-muted">haven-pq-kit.VendorSig.v1</p>
        </div>
      </div>

      {file ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3"
        >
          <div className="space-y-1.5 rounded-xl border border-line bg-canvas/70 p-3 font-mono text-[11.5px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted">Public key</span>
              <span className="truncate text-ink" title={file.publicKey}>
                {shortAddress(file.publicKey)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted">Invoice id</span>
              <span className="truncate text-ink" title={file.invoiceId}>
                {shortAddress(file.invoiceId)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted">Amount</span>
              <span className="text-paid">0.001000 fUSD</span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <CopyChip value={file.publicKey} display="Copy public key" ariaLabel="Copy public key" />
            <span className="font-mono text-[11px] text-paid">Verified locally</span>
          </div>

          <pre className="max-h-72 overflow-auto rounded-xl border border-line bg-canvas p-3 font-mono text-[10.5px] leading-relaxed text-muted">
            {JSON.stringify(
              {
                ...file,
                vendorSig: `${file.vendorSig.slice(0, 28)}… (${file.vendorSig.length} chars)`,
                publicKey: `${file.publicKey.slice(0, 28)}… (${file.publicKey.length} chars)`,
              },
              null,
              2,
            )}
          </pre>
        </motion.div>
      ) : (
        <div className="space-y-3 rounded-xl border border-dashed border-line-strong bg-canvas/50 p-4 text-[12.5px] text-muted">
          <p className="font-medium text-ink">Waiting for signature</p>
          <p className="leading-relaxed">
            Click <strong className="text-ink">Sign an invoice</strong> to generate an ephemeral ML-DSA-87 keypair in
            WebCrypto, ABI-encode the <code className="font-mono text-[11.5px] text-ink">VendorSig.v1</code> payload,
            sign it, and verify it locally.
          </p>
          <div className="space-y-1 border-t border-line pt-2.5 font-mono text-[11px]">
            <div className="flex justify-between">
              <span>Chain ID</span>
              <span className="text-ink">9800</span>
            </div>
            <div className="flex justify-between">
              <span>PayGate</span>
              <span className="text-ink">{shortAddress(GATE)}</span>
            </div>
            <div className="flex justify-between">
              <span>Algorithm</span>
              <span className="text-ink">ML-DSA-87</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <WorkspaceShell
      title={
        <>
          For <span className="word">vendors</span>
        </>
      }
      badge="ML-DSA-87 Studio"
      subtitle="A vendor gets paid by signing an invoice with its ML-DSA key. The owner registers the vendor and its payout once."
      toolbarLeft={
        <>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-ink">
            <Lock className="h-3 w-3 text-brand" />
            Client-side WebCrypto
          </span>
          <span>Ephemeral key · never leaves this tab</span>
        </>
      }
      toolbarRight={<CopyChip value={VENDOR} display={`Registered ${shortAddress(VENDOR)}`} label="vendor address" />}
      sidebar={sidebar}
      inspector={inspector}
    >
      <section className="rounded-xl border border-line-strong bg-surface p-4 shadow-sm sm:p-5">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
          <h2 className="text-[16px] font-semibold text-ink">Try step 3 in this tab</h2>
          <span className="font-mono text-[11px] text-muted">Amount: 0.001000 fUSD</span>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={status}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className={`mt-4 rounded-xl border p-3.5 text-[13.5px] ${
              status === "ready"
                ? "border-paid/35 bg-paid-soft text-paid"
                : status === "error"
                  ? "border-refused/35 bg-refused-soft text-refused"
                  : "border-line bg-canvas/60 text-muted"
            }`}
          >
            {status === "idle" ? (
              <span className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 shrink-0 text-muted" />
                No key in this tab. A new ML-DSA key is made when you sign, and it is not saved.
              </span>
            ) : null}
            {status === "signing" ? (
              <span className="flex items-center gap-2 text-brand">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                Signing.
              </span>
            ) : null}
            {status === "ready" ? (
              <span className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Signed, and the signature checks. This key is not registered, so PayGate would refuse the file.
                </span>
              </span>
            ) : null}
            {status === "error" ? (
              <span className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </span>
            ) : null}
          </motion.div>
        </AnimatePresence>

        <div className="mt-5 space-y-4">
          <div>
            <label className="block text-[12.5px] font-medium text-muted" htmlFor="payout">
              Payout address
            </label>
            <input
              id="payout"
              value={payee}
              onChange={(event) => setPayee(event.target.value)}
              spellCheck={false}
              className="mt-1.5 w-full min-w-0 rounded-lg border border-line bg-canvas px-3.5 py-2.5 font-mono text-[13px] text-ink transition-colors focus:border-brand"
            />
          </div>

          <div>
            <label className="block text-[12.5px] font-medium text-muted" htmlFor="vendor-memo">
              Memo
            </label>
            <input
              id="vendor-memo"
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              className="mt-1.5 w-full min-w-0 rounded-lg border border-line bg-canvas px-3.5 py-2.5 text-[14px] text-ink transition-colors focus:border-brand"
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-4 text-[13.5px] font-medium text-on-brand shadow-xs transition-all hover:brightness-110 disabled:opacity-60 active:scale-[0.98]"
            disabled={status === "signing"}
            onClick={sign}
          >
            {status === "signing" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileSignature className="h-4 w-4" />
            )}
            <span>{status === "signing" ? "Signing" : status === "ready" ? "Sign another" : "Sign an invoice"}</span>
          </button>

          {file ? (
            <button
              type="button"
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line-strong bg-canvas/80 px-4 text-[13.5px] font-medium text-ink transition-all hover:border-paid/50 hover:text-paid active:scale-[0.98]"
              onClick={download}
            >
              <Download className="h-4 w-4" />
              <span>Download invoice.json</span>
            </button>
          ) : null}
        </div>
      </section>
    </WorkspaceShell>
  );
}
