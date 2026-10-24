"use client";

// Client providers live here. Mount SpacetimeDBProvider (from "spacetimedb/react")
// around {children} once module_bindings exist; see lib/data/hooks.tsx.
export function Providers({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
