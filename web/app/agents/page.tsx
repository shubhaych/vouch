import type { Metadata } from "next";
import { AgentsRegistry } from "@/components/agents-registry";
import { Card } from "@/components/card";
import { EmptyState, NOT_CONNECTED } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  return (
    <>
      <PageHeader title="Agents" lede="Registered shopping agents, their principals and mandates, and a decision for every order: allow, escrow, step up or block. An agent never outranks its principal." />
      <div className="space-y-6">
        <Card title="Registry"><AgentsRegistry /></Card>
        <Card title="Order feed">
          <EmptyState title="No orders yet">{NOT_CONNECTED}</EmptyState>
        </Card>
        {/* TODO: Report incident -> reportIncident reducer */}
        <button disabled className="rounded-lg border border-line px-4 py-2 font-semibold text-muted disabled:cursor-not-allowed">Report incident</button>
      </div>
    </>
  );
}
