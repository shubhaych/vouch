// Shown wherever live data would appear. Honest by construction: it never
// invents rows, it says why there are none and what unlocks them.
export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-background px-4 py-6 text-center">
      <p className="font-semibold">{title}</p>
      {children && <p className="mt-1 text-muted">{children}</p>}
    </div>
  );
}

export const NOT_CONNECTED = "Not connected to SpacetimeDB yet. This fills in once the module is published and bindings are generated (docs/ARCHITECTURE.md).";
