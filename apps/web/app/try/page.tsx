import type { Metadata } from "next";
import { Desk } from "@/components/desk";

export const metadata: Metadata = { title: "Try to break it · Steward" };

export default function TryPage() {
  return <Desk />;
}
