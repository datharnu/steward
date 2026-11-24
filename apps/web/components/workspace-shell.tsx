"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, FileSignature, Home, Radio, ShieldAlert } from "lucide-react";
import { StewardMark } from "./brand-mark";

const RAIL_LINKS = [
  { href: "/jailbreak", label: "Jailbreak the clerk", icon: Bot },
  { href: "/gate", label: "Live Gate", icon: Radio },
  { href: "/try", label: "Try Sandbox", icon: ShieldAlert },
  { href: "/vendor", label: "Vendor Studio", icon: FileSignature },
];

export function WorkspaceShell({
  title,
  badge,
  subtitle,
  actions,
  toolbarLeft,
  toolbarRight,
  sidebar,
  inspector,
  inspectorAsAside = false,
  children,
}: {
  title: React.ReactNode;
  badge?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  toolbarLeft?: React.ReactNode;
  toolbarRight?: React.ReactNode;
  sidebar?: React.ReactNode;
  inspector?: React.ReactNode;
  inspectorAsAside?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const InspectorTag = inspectorAsAside ? "aside" : "section";

  return (
    <main className="mx-auto max-w-[1280px] px-3 pt-4 pb-28 sm:px-5 sm:pt-6 md:pb-16">
      <div className="overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-2xl shadow-black/30">
        <div className="grid min-h-[680px] md:grid-cols-[56px_minmax(0,1fr)]">
          {/* Left Icon Rail (desktop/tablet) */}
          <nav
            aria-label="Workspace"
            className="hidden flex-col items-center gap-2 border-r border-line bg-canvas/70 py-4 md:flex"
          >
            <Link
              href="/"
              title="Steward overview"
              className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl border border-line-strong bg-surface text-ink transition-colors hover:border-brand/60"
            >
              <StewardMark size={19} />
            </Link>

            {RAIL_LINKS.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  aria-label={item.label}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-all ${
                    active
                      ? "bg-brand text-on-brand shadow-xs"
                      : "text-muted hover:bg-surface-elevated hover:text-ink"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </Link>
              );
            })}

            <div className="mt-auto flex flex-col items-center gap-2">
              <Link
                href="/"
                title="Back to homepage"
                aria-label="Back to homepage"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-elevated hover:text-ink"
              >
                <Home className="h-4 w-4" />
              </Link>
              <span
                className="h-2 w-2 rounded-full bg-paid"
                title="qorechain-diana · EVM 9800"
                aria-hidden="true"
              />
            </div>
          </nav>

          {/* Main App Window Area */}
          <div className="flex min-w-0 flex-col">
            {/* Top Window Header */}
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3.5 sm:px-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-[20px] leading-tight font-semibold tracking-[-0.025em] text-ink sm:text-[22px]">
                    {title}
                  </h1>
                  {badge ? (
                    <span className="rounded-full border border-brand/35 bg-brand-soft px-2.5 py-0.5 font-mono text-[11px] font-medium text-brand">
                      {badge}
                    </span>
                  ) : null}
                </div>
                {subtitle ? <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p> : null}
              </div>
              {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
            </header>

            {/* Thin Secondary Toolbar */}
            {toolbarLeft || toolbarRight ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-elevated/45 px-4 py-2 text-[12px] text-muted sm:px-5">
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">{toolbarLeft}</div>
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">{toolbarRight}</div>
              </div>
            ) : null}

            {/* 3-Pane Dashboard Grid */}
            <div
              className={`grid min-w-0 flex-1 ${
                sidebar && inspector
                  ? "lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[260px_minmax(0,1fr)_350px]"
                  : inspector
                    ? "lg:grid-cols-[minmax(0,1fr)_360px]"
                    : sidebar
                      ? "lg:grid-cols-[270px_minmax(0,1fr)]"
                      : ""
              }`}
            >
              {/* Left Sidebar Pane */}
              {sidebar ? (
                <div className="min-w-0 border-b border-line bg-surface p-4 lg:border-b-0 xl:border-r">
                  {sidebar}
                </div>
              ) : null}

              {/* Center Dotted Canvas */}
              <div className="steward-canvas-dots min-w-0 p-4 sm:p-5">{children}</div>

              {/* Right Inspector Pane */}
              {inspector ? (
                <InspectorTag className="min-w-0 border-t border-line bg-surface p-4 sm:p-5 lg:border-t-0 lg:border-l">
                  {inspector}
                </InspectorTag>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
