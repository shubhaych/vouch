import Link from "next/link";
import { Card } from "@/components/card";
import { HomeCounters } from "@/components/home-counters";
import { LAYERS, THESIS } from "@/lib/product";

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="max-w-3xl">
        <h1 className="text-4xl font-bold tracking-tight">{THESIS}</h1>
        <p className="mt-4 text-xl text-muted">
          Vouch gives a retailer&apos;s refunds team a stored, expiring Vouch Record for each customer and each shopping
          agent. The record sets how fast a refund moves, an AI checks the contested claims against the evidence, and every
          decision shows its reasons.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/shopper/return" className="rounded-lg bg-accent px-5 py-2.5 font-semibold text-white hover:opacity-90">Run the demo</Link>
          <Link href="/atlas#proof" className="rounded-lg border border-line bg-surface px-5 py-2.5 font-semibold hover:border-accent">See the proof</Link>
        </div>
      </section>

      <HomeCounters />

      <section>
        <h2 className="mb-4 text-2xl font-semibold">Four layers, one engine</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {LAYERS.map((l) => (
            <Card key={l.n} title={`${l.n}. ${l.name}`}>
              <p>{l.does}</p>
              <p className="mt-3 text-sm text-muted">AI: {l.ai}</p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
