"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { StewardMark } from "./brand-mark";

const NAV = [
  { href: "/jailbreak", label: "Jailbreak", wideOnly: false },
  { href: "/gate", label: "Gate", wideOnly: false },
  { href: "/try", label: "Try", wideOnly: false },
  { href: "/vendor", label: "Vendors", wideOnly: true },
] as const;

function applyTheme(next: "dark" | "light") {
  const root = document.documentElement;
  if (document.startViewTransition) {
    document.startViewTransition(() => root.setAttribute("data-theme", next));
  } else {
    root.setAttribute("data-theme", next);
  }
  localStorage.setItem("steward-theme", next);
}

export function Header() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink shadow-xs transition-all duration-200 group-hover:border-brand/50 group-hover:scale-105">
            <StewardMark size={19} />
          </span>
          <span className="text-[17px] font-semibold tracking-[-0.025em] text-ink">Steward</span>
          <span className="hidden rounded-full border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-muted sm:inline-flex">
            ML-DSA-87
          </span>
        </Link>

        <nav aria-label="Main" className="flex items-center gap-1">
          <div className="flex items-center rounded-full border border-line bg-surface/80 p-1">
            {NAV.map((item) => {
              const on = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={on ? "page" : undefined}
                  className={`relative min-h-9 items-center rounded-full px-2.5 text-[13.5px] font-medium transition-colors sm:px-3.5 sm:text-[14px] ${
                    item.wideOnly ? "hidden sm:inline-flex" : "inline-flex"
                  } ${on ? "text-ink" : "text-muted hover:text-ink"}`}
                >
                  {on ? (
                    <motion.span
                      layoutId="nav-active-pill"
                      transition={{ type: "spring", stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-full border border-line-strong bg-surface-elevated shadow-xs"
                    />
                  ) : null}
                  <span className="relative z-10">{item.label}</span>
                </Link>
              );
            })}
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="ml-1 inline-flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface/80 text-muted transition-all hover:border-line-strong hover:text-ink active:scale-95"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </nav>
      </div>
    </header>
  );
}
