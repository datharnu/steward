"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/gate", label: "Gate" },
  { href: "/try", label: "Try" },
  { href: "/vendor", label: "Vendors" },
];

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
    <header className="mx-auto flex h-16 max-w-[960px] items-center justify-between gap-4 px-5">
      <Link href="/" className="text-[18px] font-medium">
        Steward
      </Link>
      <nav aria-label="Main" className="flex items-center gap-1 sm:gap-3">
        {NAV.map((item) => {
          const on = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={on ? "page" : undefined}
              className={`inline-flex min-h-11 items-center px-2 text-[15px] ${on ? "text-ink" : "text-muted hover:text-ink"}`}
            >
              {item.label}
            </Link>
          );
        })}
        <button type="button" onClick={toggleTheme} className="min-h-11 px-2 text-[15px] text-muted hover:text-ink">
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </nav>
    </header>
  );
}
