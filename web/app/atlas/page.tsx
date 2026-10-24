import type { Metadata } from "next";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { KillSwitchRow, LedgerFeed, SpeedLossCurve } from "@/components/atlas-live";
import { PROOF, SOURCES } from "@/lib/product";

export const metadata: Metadata = { title: "Atlas" };

export default function AtlasPage() {
  return (
    <>
      <PageHeader title="Atlas" lede="Speed against loss, the proof, what is real, and the switch that proves the agents are the product." />
      <div className="space-y-6">
        <Card title="Speed against loss" provenance="simulated"><SpeedLossCurve /></Card>

        <Card id="proof" title="Proof: planted errors and an answer key" provenance="simulated">
          <p className="mb-3 text-muted">
            Deterministic detectors on a simulated company. The standard set was used to tune the desk, so the held-out set is
            the honest number. The CREAO agents and the refund risk model have not been scored against the answer key yet.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-sm text-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">Detector</th>
                  <th className="py-2 pr-4 font-medium">Standard set<span className="block text-xs">{PROOF.standardSet}</span></th>
                  <th className="py-2 font-medium">Held-out set<span className="block text-xs">{PROOF.heldOutSet}</span></th>
                </tr>
              </thead>
              <tbody>
                {PROOF.rows.map((r) => (
                  <tr key={r.detector} className="border-t border-line align-top">
                    <td className="py-2 pr-4 font-semibold">{r.detector}</td>
                    <td className="py-2 pr-4">{r.standard}</td>
                    <td className="py-2">{r.heldOut}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Where each source stands">
          <ul className="divide-y divide-line">
            {SOURCES.map((s) => (
              <li key={s.name} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-sm text-muted">{s.note}</p>
                </div>
                <ProvenanceBadge kind={s.provenance} />
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Kill switch"><KillSwitchRow /></Card>
        <Card title="Ledger feed"><LedgerFeed /></Card>
      </div>
    </>
  );
}
