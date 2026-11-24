import type { Metadata } from "next";
import { Jailbreak } from "@/components/jailbreak";

export const metadata: Metadata = { title: "Jailbreak the clerk · Steward" };

export default function JailbreakPage() {
  return <Jailbreak />;
}
