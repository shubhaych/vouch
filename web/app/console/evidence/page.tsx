import type { Metadata } from "next";
import { Card } from "@/components/card";
import { EmptyState, NOT_CONNECTED } from "@/components/empty-state";

export const metadata: Metadata = { title: "Evidence" };

// One card per piece of evidence the Refund Desk reads. Photos are described as
// "internally consistent, not authenticated"; we cannot authenticate images.
const PANELS = [
  ["Claim photos", "Photos the customer attached, with hashes."],
  ["Duplicate-photo hits", "The same photo under other accounts."],
  ["Carrier record", "Delivery facts: the carrier is the trusted source for these."],
  ["Policy clause", "The clause the Refund Desk cited, from the merchant's policy text."],
  ["Source conflicts", "Where sources disagree, which one was trusted, and why."],
  ["Risk-model score", "One input to the Refund Desk. Never decides alone."],
  ["Cross-examination", "Ask why a decision was made; the answer cites data, rule, run and person."],
] as const;

export default function EvidencePage() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {PANELS.map(([title, blurb]) => (
        <Card key={title} title={title}>
          <p className="mb-3 text-muted">{blurb}</p>
          <EmptyState title="Nothing selected">{NOT_CONNECTED}</EmptyState>
        </Card>
      ))}
    </div>
  );
}
