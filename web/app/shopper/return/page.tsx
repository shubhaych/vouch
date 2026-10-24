import type { Metadata } from "next";
import { Card } from "@/components/card";

export const metadata: Metadata = { title: "Return" };

export default function ReturnPage() {
  // TODO: wire to the submitClaim reducer; downsize photos to <= 400 KB client-side first.
  return (
    <Card title="Start a return">
      <form className="space-y-4">
        <fieldset disabled className="space-y-4">
          <label className="block"><span className="mb-1 block font-medium">Order</span>
            <select className="w-full rounded-lg border border-line bg-background p-2.5"><option>Pick an order</option></select></label>
          <label className="block"><span className="mb-1 block font-medium">What went wrong</span>
            <textarea rows={3} className="w-full rounded-lg border border-line bg-background p-2.5" /></label>
          <label className="block"><span className="mb-1 block font-medium">Photos</span>
            <input type="file" accept="image/*" multiple className="w-full" /></label>
          <button className="rounded-lg bg-accent px-5 py-2.5 font-semibold text-white opacity-60">Submit return</button>
        </fieldset>
      </form>
      <p className="mt-4 text-sm text-muted">The form is wired up with the claim flow. Your lane and a countdown to cash back appear here after you submit.</p>
    </Card>
  );
}
