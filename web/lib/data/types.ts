// UI-facing row shapes, mirroring the public SpacetimeDB tables in
// module/src/schema.ts. Once `npm run stdb:generate` has produced
// module_bindings, map the generated rows to these in lib/data/hooks.ts so the
// pages do not change.
import type { Lane, Provenance, Seat, Tier } from "@vouch/module/types";

export interface Claim { id: string; subjectId: string; amountCents: number; kind: string; status: string; lane: Lane | ""; reasonCodes: string[]; provenance: Provenance; createdAt: Date }
export interface VouchRecord { subjectId: string; tier: Tier; reasons: { text: string; field: string }[]; notFound: string[]; runId: string; runUrl: string; issuedAt: Date; expiresAt: Date; provenance: Provenance }
export interface AgentRun { runId: string; seat: Seat; caseRef: string; status: "started" | "completed" | "failed" | "cancelled"; shareUrl: string; startedAt: Date; finishedAt: Date | null }
export interface Decision { id: string; caseRef: string; kind: string; amountCents: number; status: "proposed" | "approved" | "rejected" | "posted"; rule: string; reason: string; note: string; runUrl: string; at: Date }
export interface LedgerEvent { seq: string; subjectId: string; kind: string; hash: string; prevHash: string; at: Date }
export interface RegisteredAgent { id: string; principalId: string; tier: Tier; mandate: { category: string; capCents: number }[]; provenance: Provenance }
