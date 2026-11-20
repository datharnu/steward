"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Plus } from "lucide-react";

type FaqItem = {
  q: string;
  a: string;
};

const ITEMS: FaqItem[] = [
  {
    q: "What happens if the AI planner is completely prompt-injected?",
    a: "Invoice memos and emails are treated strictly as untrusted data. Even if the planner is tricked into proposing a different recipient, an inflated amount, or a direct token transfer, the local policy clamps it first — and on chain, QoreChain’s spending rule and PayGate refuse any transaction that does not carry a valid ML-DSA-87 signature from a registered vendor to its registered payout within the caps.",
  },
  {
    q: "What if an attacker steals the agent’s machine and skips the local policy?",
    a: "Two of Steward’s four layers live on chain. The agent key’s spending rule only permits PayGate.pay and PayGate.queue (with a 1 uqor limit and no denoms), so calling fUSD.transfer or sending coins directly fails at the chain level. Inside PayGate, forged signatures, unregistered payees, replayed invoice IDs, and over-cap payments all revert regardless of what runs on the agent’s host.",
  },
  {
    q: "Why does Steward use ML-DSA-87 instead of standard ecrecover?",
    a: "Steward is built for post-quantum security on QoreChain. Vendor invoice signatures, owner approvals, pauses, and registry changes are verified on chain through QoreChain’s pqcVerify precompile (0x…0a01) using NIST FIPS 204 ML-DSA-87. The contract suite contains zero ecrecover calls.",
  },
  {
    q: "What happens when a genuine invoice is over the per-invoice cap?",
    a: "PayGate.pay refuses anything above the vendor’s per-invoice cap (0.020000 fUSD on the testnet deploy). Instead, the agent can call PayGate.queue, which records the invoice without moving any fUSD. The owner then opens a hybrid-signed EVM window and releases the payment with an ML-DSA-87 approval.",
  },
  {
    q: "Does Steward prove that the vendor actually completed the work?",
    a: "No. Steward proves who was paid, that the owner pre-approved that vendor and cap, that the vendor signed the exact invoice with ML-DSA-87, and that the invoice was paid at most once. Verifying off-chain work delivery remains outside the gate.",
  },
  {
    q: "Why does the agent’s chain link expire after 24 hours?",
    a: "QoreChain scopes linked authenticators to a 24-hour window by design. Once expired, the agent key cannot submit new transactions until the owner explicitly revokes the old authenticator and links a fresh one. All recorded testnet proofs, live gate reads, and in-browser receipt checks continue to work without an active link.",
  },
  {
    q: "Can I verify the testnet record without connecting a wallet?",
    a: "Yes. This site reads QoreChain directly and never asks for a wallet or sends a transaction. On /gate you can read PayGate’s live balance and verify the agent’s ML-DSA-87 signed receipt right in your browser — including tampering one character in memory to watch the signature check fail.",
  },
];

export function Faq() {
  const reduce = useReducedMotion() ?? false;
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="mx-auto max-w-[1040px] scroll-mt-20 py-16 md:py-20" aria-labelledby="faq-heading">
      <div className="grid gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:gap-14">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="inline-flex items-center gap-2 text-[13px] font-medium text-brand">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
            <span>Questions</span>
          </div>
          <h2 id="faq-heading" className="mt-2 text-[30px] leading-[1.12] font-medium tracking-[-0.03em] sm:text-[38px]">
            Common questions.
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">
            How Steward’s on-chain boundaries, post-quantum signatures, and scope limits hold up under attack.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/gate"
              className="group inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-4 text-[13.5px] font-medium text-ink transition-colors hover:border-brand/50 hover:text-brand"
            >
              <span>Inspect the live gate</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>

        <dl className="divide-y divide-line border-y border-line">
          {ITEMS.map((item, idx) => {
            const isOpen = open === idx;
            return (
              <div key={item.q} className="py-1">
                <dt>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : idx)}
                    className="flex w-full items-center justify-between gap-4 py-4 text-left text-[16px] font-medium tracking-[-0.01em] text-ink transition-colors hover:text-brand"
                  >
                    <span>{item.q}</span>
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-all duration-200 ${
                        isOpen
                          ? "rotate-45 border-brand/50 bg-brand-soft text-brand"
                          : "border-line bg-surface text-muted"
                      }`}
                      aria-hidden="true"
                    >
                      <Plus className="h-4 w-4" />
                    </span>
                  </button>
                </dt>
                <AnimatePresence initial={false}>
                  {isOpen ? (
                    <motion.dd
                      initial={reduce ? false : { height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={reduce ? undefined : { height: 0, opacity: 0 }}
                      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <p className="pb-5 pr-8 text-[14.5px] leading-[1.65] text-muted">{item.a}</p>
                    </motion.dd>
                  ) : null}
                </AnimatePresence>
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}
