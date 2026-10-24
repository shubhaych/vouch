import type { Metadata } from "next";
import { Card } from "@/components/card";
import { LadderTable } from "@/components/ladder-table";
import { VouchRecordView } from "@/components/vouch-record-view";

export const metadata: Metadata = { title: "My Vouch Record" };

export default function RecordPage() {
  return (
    <div className="space-y-6">
      <Card title="Your Vouch Record"><VouchRecordView /></Card>
      <Card title="How refunds move for each tier"><LadderTable /></Card>
    </div>
  );
}
