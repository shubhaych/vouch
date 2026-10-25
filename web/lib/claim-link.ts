// The claim link the shop puts in its QR code. It carries what the phone needs
// to show the claim and the upload box at once (nonce, finger count, item,
// amount, the agent's public id), so the phone does not wait for SpacetimeDB
// before the customer can record. Live rows replace these values when they
// arrive. The agent's login token is never in the link: whoever holds it
// would be that agent. The upload is authorised by the nonce, checked by the worker.

export interface ClaimHint {
  nonce: string;
  fingers: number;
  refundId?: bigint;
  purchaseId?: bigint;
  agentId?: number;
  sku?: number;
  business?: number;
  cents?: number;
  reason?: string;
}

/** Path and query for one claim; prefix it with the site origin for a QR code. */
export function claimHref(
  claim: { id: bigint; nonce: string; fingerCount: number; refundId: bigint; agentId: number },
  purchase?: { id: bigint; item: number; business: number },
  refund?: { amount: number; reasonCode: string },
): string {
  const q = new URLSearchParams({ n: claim.nonce, f: String(claim.fingerCount), r: String(claim.refundId), a: String(claim.agentId) });
  if (purchase) { q.set("p", String(purchase.id)); q.set("s", String(purchase.item)); q.set("b", String(purchase.business)); }
  if (refund) { q.set("c", String(refund.amount)); q.set("why", refund.reasonCode); }
  return `/claim/${claim.id}?${q}`;
}

type Search = Record<string, string | string[] | undefined>;
const one = (s: Search, k: string) => { const v = s[k]; return typeof v === "string" ? v : undefined; };
const int = (v: string | undefined) => (v && /^\d{1,9}$/.test(v) ? Number(v) : undefined);
const big = (v: string | undefined) => (v && /^\d{1,19}$/.test(v) ? BigInt(v) : undefined);

/** Null for an old link without a nonce: the page then waits for the live rows as before. */
export function parseHint(s: Search): ClaimHint | null {
  const nonce = one(s, "n");
  const fingers = int(one(s, "f"));
  if (!nonce || !/^[0-9a-f]{4,64}$/i.test(nonce) || !fingers || fingers > 10) return null;
  const why = one(s, "why");
  return {
    nonce, fingers,
    refundId: big(one(s, "r")), purchaseId: big(one(s, "p")), agentId: int(one(s, "a")),
    sku: int(one(s, "s")), business: int(one(s, "b")), cents: int(one(s, "c")),
    reason: why && /^[a-z_]{1,40}$/.test(why) ? why : undefined,
  };
}

/** Server components can only hand plain values to client ones. */
export const hintToProps = (h: ClaimHint | null) => (h ? { ...h, refundId: h.refundId?.toString(), purchaseId: h.purchaseId?.toString() } : null);
export type HintProps = ReturnType<typeof hintToProps>;
export const hintFromProps = (h: HintProps): ClaimHint | null => (h ? { ...h, refundId: h.refundId ? BigInt(h.refundId) : undefined, purchaseId: h.purchaseId ? BigInt(h.purchaseId) : undefined } : null);
