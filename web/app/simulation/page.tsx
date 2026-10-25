import type { Metadata } from "next";
import { SimulationView } from "@/components/simulation/simulation-view";

export const metadata: Metadata = { title: "Simulation · Vouch" };

export default function SimulationPage() {
  return <SimulationView />;
}
