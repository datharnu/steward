/**
 * First-layer abuse limits for /api/jailbreak. In memory, per server instance: serverless
 * instances do not share memory, so the hard cost ceiling is the spend limit on the provider
 * keys themselves (see README, "Jailbreak the clerk").
 */

const MINUTE = 60_000;

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export type LimitResult = { ok: true } | { ok: false; scope: "minute" | "day"; retryAfterSec: number };

export class RateLimiter {
  private readonly hits = new Map<string, { recent: number[]; day: string; dayCount: number }>();

  constructor(
    readonly perMinute: number,
    readonly perDay: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  /** Counts one run for `key` if it is within both limits. */
  take(key: string): LimitResult {
    const t = this.now();
    const day = utcDay(t);
    let entry = this.hits.get(key);
    if (!entry || entry.day !== day) {
      entry = { recent: [], day, dayCount: 0 };
      if (!this.hits.has(key) && this.hits.size >= this.maxKeys) this.prune(t);
      this.hits.set(key, entry);
    }
    entry.recent = entry.recent.filter((at) => t - at < MINUTE);
    if (entry.dayCount >= this.perDay) {
      const nextDay = Date.parse(`${day}T00:00:00Z`) + 24 * 3600 * 1000;
      return { ok: false, scope: "day", retryAfterSec: Math.max(1, Math.ceil((nextDay - t) / 1000)) };
    }
    if (entry.recent.length >= this.perMinute) {
      return { ok: false, scope: "minute", retryAfterSec: Math.max(1, Math.ceil((entry.recent[0] + MINUTE - t) / 1000)) };
    }
    entry.recent.push(t);
    entry.dayCount += 1;
    return { ok: true };
  }

  private prune(t: number): void {
    const day = utcDay(t);
    for (const [k, v] of this.hits) {
      if (v.day !== day || v.recent.every((at) => t - at >= MINUTE)) this.hits.delete(k);
    }
    // Still full: drop the oldest entries (Map keeps insertion order).
    while (this.hits.size >= this.maxKeys) {
      const first = this.hits.keys().next().value;
      if (first === undefined) break;
      this.hits.delete(first);
    }
  }
}

/** A global per-UTC-day counter, e.g. for paid Claude runs. */
export class DailyCap {
  private day = "";
  private used = 0;

  constructor(
    readonly cap: number,
    private readonly now: () => number = Date.now,
  ) {}

  private roll(): void {
    const d = utcDay(this.now());
    if (d !== this.day) {
      this.day = d;
      this.used = 0;
    }
  }

  remaining(): number {
    this.roll();
    return Math.max(0, this.cap - this.used);
  }

  take(): boolean {
    this.roll();
    if (this.used >= this.cap) return false;
    this.used += 1;
    return true;
  }

  /** Gives back a run that was counted but never reached the model. */
  refund(): void {
    this.roll();
    if (this.used > 0) this.used -= 1;
  }
}

export function intFromEnv(value: string | undefined, fallback: number, min = 0, max = 100_000): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

/** The client address Vercel (or any proxy) reports. Only the first hop is the client. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip")?.trim() || "unknown";
  return ip.slice(0, 64);
}
