import type { Metadata } from "next";
import { VendorSign } from "@/components/vendor";

export const metadata: Metadata = { title: "For vendors · Steward" };

export default function VendorPage() {
  return (
    <main className="mx-auto max-w-[960px] px-5 pb-16">
      <h1 className="text-[34px] leading-[1.08] font-medium tracking-[-0.02em] md:text-[44px]">
        For <span className="word">vendors</span>
      </h1>
      <p className="mt-3 max-w-[62ch] text-[16px] text-muted">
        A vendor gets paid by signing an invoice with its ML-DSA key. The owner registers the vendor and its payout once.
        After that, the agent can only pay invoices that carry this signature.
      </p>
      <ol className="mt-8 grid gap-4 border-t border-line pt-6 sm:grid-cols-3">
        <li>
          <p className="font-mono text-[12px] text-muted">1</p>
          <p className="text-[16px] font-medium">Register a key</p>
          <p className="text-[14px] text-muted">The vendor’s ML-DSA key goes on chain with proof of possession. That is a transaction.</p>
        </li>
        <li>
          <p className="font-mono text-[12px] text-muted">2</p>
          <p className="text-[16px] font-medium">The owner adds you</p>
          <p className="text-[14px] text-muted">Your payout and cap, signed by the owner, after a 60-second timelock.</p>
        </li>
        <li>
          <p className="font-mono text-[12px] text-muted">3</p>
          <p className="text-[16px] font-medium">Sign invoices</p>
          <p className="text-[14px] text-muted">Each one names you, the payout, the amount, and an id that can only be paid once.</p>
        </li>
      </ol>
      <VendorSign />
    </main>
  );
}
