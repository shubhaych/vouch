import type { Metadata } from "next";
import { WorldView } from "@/components/world/world-view";

export const metadata: Metadata = { title: "Vouch World" };

export default function WorldPage() {
  return <WorldView />;
}
