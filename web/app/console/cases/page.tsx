import type { Metadata } from "next";
import { Card } from "@/components/card";
import { CasesTable } from "@/components/cases-table";

export const metadata: Metadata = { title: "Cases" };

export default function CasesPage() {
  return (
    <div className="space-y-6">
      <Card title="Case queue"><CasesTable /></Card>
      <Card title="Judge's scenario">
        <p className="mb-3 text-muted">Drop in a claim, a photo, a carrier record, or a bank-detail change and watch the desk respond.</p>
        {/* TODO: scenario form -> submitClaim reducer + seeded evidence */}
        <textarea disabled rows={3} placeholder="Describe a scenario" className="w-full rounded-lg border border-line bg-background p-3 disabled:cursor-not-allowed" />
      </Card>
    </div>
  );
}
