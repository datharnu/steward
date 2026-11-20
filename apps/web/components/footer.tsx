import Link from "next/link";
import { StewardMark } from "./brand-mark";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-line/80 bg-canvas/60 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 px-4 py-6 text-[13px] text-muted sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-line bg-surface text-ink">
            <StewardMark size={15} />
          </span>
          <span className="font-medium text-ink">Steward</span>
          <span className="text-line-strong">·</span>
          <span className="font-mono text-[12px]">qorechain-diana · EVM 9800 · ML-DSA-87</span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/" className="transition-colors hover:text-ink">
            Overview
          </Link>
          <Link href="/try" className="transition-colors hover:text-ink">
            Sandbox
          </Link>
          <Link href="/gate" className="transition-colors hover:text-ink">
            Live Gate
          </Link>
          <Link href="/vendor" className="transition-colors hover:text-ink">
            Vendors
          </Link>
        </div>
      </div>
    </footer>
  );
}
