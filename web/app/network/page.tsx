import type { Metadata } from "next";
import { NetworkView } from "@/components/network/network-view";

export const metadata: Metadata = { title: "Merchant network · Vouch" };

export default function NetworkPage() {
  return <NetworkView />;
}
