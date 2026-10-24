// Browser-visible SpacetimeDB settings. Non-secret only: sponsor keys live in
// the worker and never reach web/.
export const STDB_URI = process.env.NEXT_PUBLIC_STDB_URI ?? "ws://localhost:3000";
export const STDB_DB = process.env.NEXT_PUBLIC_STDB_DB ?? "vouch";
