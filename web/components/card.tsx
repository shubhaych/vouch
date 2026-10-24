import type { Provenance } from "@vouch/module/types";
import { ProvenanceBadge } from "./provenance-badge";

export function Card({ title, provenance, children, id }: { title?: string; provenance?: Provenance; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="rounded-xl border border-line bg-surface p-5 shadow-sm">
      {(title || provenance) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {provenance && <ProvenanceBadge kind={provenance} />}
        </header>
      )}
      {children}
    </section>
  );
}
