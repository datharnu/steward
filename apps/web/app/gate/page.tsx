import type { Metadata } from "next";
import { GatePanel } from "@/components/gate";

export const metadata: Metadata = { title: "The gate, live · Steward" };

export default function GatePage() {
  return <GatePanel />;
}
