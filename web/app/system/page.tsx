import type { Metadata } from "next";
import { SystemView } from "@/components/system/system-view";

export const metadata: Metadata = { title: "System" };

export default function SystemPage() {
  return <SystemView />;
}
