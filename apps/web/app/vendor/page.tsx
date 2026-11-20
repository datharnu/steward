import type { Metadata } from "next";
import { VendorSign } from "@/components/vendor";

export const metadata: Metadata = { title: "For vendors · Steward" };

export default function VendorPage() {
  return <VendorSign />;
}
