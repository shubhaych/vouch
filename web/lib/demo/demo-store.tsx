"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyDecision,
  makeHandoffClaim,
  SEED_CLAIMS,
  type DemoClaim,
} from "./claims";

interface DemoStore {
  claims: DemoClaim[];
  selectedId: string;
  selected: DemoClaim;
  select: (id: string) => void;
  decide: (action: "approve" | "decline" | "more_evidence") => void;
  simulateIncoming: () => DemoClaim;
  handoffClaimId: string | null;
  /** Live SpacetimeDB claim id for the phone handoff (merchant result link). */
  liveMerchantClaimId: string | null;
  setLiveMerchantClaimId: (id: string | null) => void;
  approvalDurationMs: number | null;
  resetDemo: () => void;
}

const Ctx = createContext<DemoStore | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [claims, setClaims] = useState<DemoClaim[]>(() => SEED_CLAIMS.map((c) => ({ ...c })));
  const [selectedId, setSelectedId] = useState(SEED_CLAIMS[0]!.id);
  const [handoffClaimId, setHandoffClaimId] = useState<string | null>(null);
  const [liveMerchantClaimId, setLiveMerchantClaimId] = useState<string | null>(null);
  const [handoffSubmittedAt, setHandoffSubmittedAt] = useState<number | null>(null);
  const [approvalDurationMs, setApprovalDurationMs] = useState<number | null>(null);

  const selected = useMemo(
    () => claims.find((c) => c.id === selectedId) ?? claims[0]!,
    [claims, selectedId],
  );

  const select = useCallback((id: string) => setSelectedId(id), []);

  const decide = useCallback(
    (action: "approve" | "decline" | "more_evidence") => {
      const now = new Date();
      setClaims((prev) =>
        prev.map((c) => {
          if (c.id !== selectedId) return c;
          const next = applyDecision(c, action, now);
          if (c.isLiveHandoff && action === "approve" && handoffSubmittedAt != null) {
            setApprovalDurationMs(now.getTime() - handoffSubmittedAt);
          }
          return next;
        }),
      );
    },
    [selectedId, handoffSubmittedAt],
  );

  const simulateIncoming = useCallback(() => {
    const claim = makeHandoffClaim();
    setClaims((prev) => [claim, ...prev.filter((c) => !c.isLiveHandoff)]);
    setSelectedId(claim.id);
    setHandoffClaimId(claim.id);
    setHandoffSubmittedAt(Date.now());
    setApprovalDurationMs(null);
    return claim;
  }, []);

  const resetDemo = useCallback(() => {
    setClaims(SEED_CLAIMS.map((c) => ({ ...c })));
    setSelectedId(SEED_CLAIMS[0]!.id);
    setHandoffClaimId(null);
    setLiveMerchantClaimId(null);
    setHandoffSubmittedAt(null);
    setApprovalDurationMs(null);
  }, []);

  const value = useMemo(
    () => ({
      claims,
      selectedId,
      selected,
      select,
      decide,
      simulateIncoming,
      handoffClaimId,
      liveMerchantClaimId,
      setLiveMerchantClaimId,
      approvalDurationMs,
      resetDemo,
    }),
    [
      claims,
      selectedId,
      selected,
      select,
      decide,
      simulateIncoming,
      handoffClaimId,
      liveMerchantClaimId,
      approvalDurationMs,
      resetDemo,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDemo() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDemo must be used inside DemoProvider");
  return ctx;
}
