import { formatFusd } from "@/lib/engine";

const tone = {
  paid: "text-paid",
  queued: "text-queued",
  refused: "text-refused",
  empty: "text-ink",
} as const;

export function Money({
  base,
  tone: kind = "empty",
}: {
  base: bigint;
  tone?: keyof typeof tone;
}) {
  return (
    <span className={`font-mono tabular-nums ${tone[kind]}`} title={`${base.toString()} base units`}>
      {formatFusd(base)}
    </span>
  );
}
