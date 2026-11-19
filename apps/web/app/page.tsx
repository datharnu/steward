import Link from "next/link";
import { Ledger } from "@/components/ledger";

const LAYERS = [
  { name: "Chain rule", body: "The agent key may call pay and queue on the gate. It cannot call the token, or send coins." },
  { name: "PayGate", body: "Pays only a vendor-signed invoice, to the payout the owner registered, once, inside the caps." },
  { name: "Mandate", body: "The owner’s signed budget and vendor list. Unsigned, expired, or another agent’s is refused." },
  { name: "Policy", body: "Whatever the planner says, the action is clamped to the mandate before a transaction exists." },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-[960px] px-5 pb-16">
      <h1 className="max-w-[20ch] text-[34px] leading-[1.08] font-medium tracking-[-0.02em] md:text-[48px]">
        An AI clerk pays your invoices. It cannot be talked into paying <span className="word">anyone</span> else.
      </h1>
      <p className="mt-4 max-w-[62ch] text-[17px] text-muted">
        Even if the planner is fully prompt-injected, the only payment the chain allows is an invoice signed with the
        vendor’s ML-DSA key, to the vendor the owner approved, once, within the caps.
      </p>
      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
        <Link href="/try" className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-[15px] text-on-brand">
          Try to break it
        </Link>
        <Link href="/gate" className="inline-flex min-h-11 items-center text-[15px] text-ink underline-offset-4 hover:underline">
          Read the gate live
        </Link>
      </div>

      <section className="mt-14" aria-labelledby="layers">
        <h2 id="layers" className="text-[20px] font-medium">
          Four layers, each refuses on its own
        </h2>
        <ol className="mt-4 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 md:grid-cols-4">
          {LAYERS.map((layer, index) => (
            <li key={layer.name} className="bg-canvas p-4">
              <p className="font-mono text-[12px] text-muted">{index + 1}</p>
              <p className="mt-1 text-[16px] font-medium">{layer.name}</p>
              <p className="mt-1 text-[14px] text-muted">{layer.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-14" aria-labelledby="record">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="record" className="text-[20px] font-medium">
            What happened on testnet
          </h2>
          <p className="text-[14px] text-muted">qorechain-diana, 19 Nov 2026</p>
        </div>
        <p className="mt-2 max-w-[62ch] text-[15px] text-muted">
          Seven transactions, each still on chain. Copy a hash into the explorer to check it.
        </p>
        <div className="mt-5">
          <Ledger />
        </div>
      </section>
    </main>
  );
}
