"use client";

import { useEffect, useState } from "react";

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
    <header className="mx-auto flex h-16 max-w-[960px] items-center justify-between px-5">
      <a href="/" className="text-[18px] font-medium">
        Steward
      </a>
      <button type="button" onClick={toggleTheme} className="min-h-11 text-muted hover:text-ink">
        {theme === "dark" ? "Light" : "Dark"}
      </button>
    </header>
  );
}
