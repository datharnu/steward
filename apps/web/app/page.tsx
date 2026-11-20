import { HomeHero } from "@/components/home-hero";
import { HowSteward } from "@/components/how-steward";
import { FailureScene } from "@/components/failure-scene";
import { ResearchBand } from "@/components/research-band";
import { Ledger } from "@/components/ledger";
import { Faq } from "@/components/faq";

export default function Home() {
  return (
    <main className="mx-auto max-w-[1040px] px-5 pb-24">
      <HomeHero />

      <div className="border-t border-line/70">
        <HowSteward />
      </div>

      <div className="border-t border-line/70">
        <FailureScene />
      </div>

      <div className="border-t border-line/70">
        <ResearchBand />
      </div>

      <section className="border-t border-line/70 py-16 md:py-20" aria-labelledby="record">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-[13px] font-medium text-brand">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
              <span>On-chain record</span>
            </div>
            <h2 id="record" className="mt-2 text-[30px] leading-[1.12] font-medium tracking-[-0.03em] sm:text-[38px]">
              What happened on testnet.
            </h2>
            <p className="mt-3 max-w-[62ch] text-[15px] text-muted">
              Seven transactions recorded on qorechain-diana, each still on chain. Copy any hash into the explorer to
              check it.
            </p>
          </div>
          <span className="rounded-full border border-line bg-surface px-3 py-1 font-mono text-[12px] text-muted">
            qorechain-diana · 19 Nov 2026
          </span>
        </div>
        <div className="mt-8">
          <Ledger />
        </div>
      </section>

      <div className="border-t border-line/70">
        <Faq />
      </div>
    </main>
  );
}
