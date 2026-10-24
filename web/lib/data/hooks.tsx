"use client";

// THE SEAM. Today every hook reports "disconnected": SpacetimeDB bindings do
// not exist until the hour-3 gate passes. To go live:
//   1. npm run stdb:generate  (creates web/module_bindings)
//   2. mount SpacetimeDBProvider in app/providers.tsx
//   3. replace a hook body with useTable(...) mapped to the types in ./types
// Pages already handle disconnected / loading / ready, so they stay as they are.
import { disconnected, type Live } from "./live";
import type { AgentRun, Claim, Decision, LedgerEvent, RegisteredAgent, VouchRecord } from "./types";
import { DEFAULT_POLICY, type MerchantPolicy } from "@vouch/module/types";

export const useClaims = (): Live<Claim> => disconnected();
export const useVouchRecord = (subjectId: string): Live<VouchRecord> => {
  void subjectId; // used by the live implementation
  return disconnected();
};
export const useAgentRuns = (): Live<AgentRun> => disconnected();
export const useDecisions = (): Live<Decision> => disconnected();
export const useLedger = (): Live<LedgerEvent> => disconnected();
export const useRegisteredAgents = (): Live<RegisteredAgent> => disconnected();

/** The kill switch. `null` means unknown (not connected): the UI must not claim either state. */
export const useCreaoEnabled = (): boolean | null => null;

/** Falls back to the guide's default policy until the merchant_policy row is readable. */
export const useMerchantPolicy = (): { policy: MerchantPolicy; provenance: "seeded" | "live" } => ({ policy: DEFAULT_POLICY, provenance: "seeded" });
