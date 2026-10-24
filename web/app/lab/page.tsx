import type { Metadata } from "next";
import { LabView } from "@/components/lab/lab-view";

export const metadata: Metadata = { title: "Detector Lab" };

export default function LabPage() {
  return <LabView />;
}
