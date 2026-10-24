import type { Metadata } from "next";
import { Card } from "@/components/card";
import { BooksTable } from "@/components/books-table";

export const metadata: Metadata = { title: "Books" };

export default function BooksPage() {
  return (
    <div className="space-y-6">
      <Card title="Proposals, approvals and postings"><BooksTable /></Card>
      <Card title="Beancount export">
        <p className="mb-3 text-muted">Entries carry the decision, proposer, approver and poster as metadata. Unbalanced entries are refused.</p>
        {/* TODO: download of world/out/combined.beancount once books.py has run */}
        <button disabled className="rounded-lg border border-line px-4 py-2 font-semibold text-muted disabled:cursor-not-allowed">Download .beancount</button>
      </Card>
    </div>
  );
}
