// Product facts from the build guide (version 4). Pages read from here so the
// copy lives in one place. Numbers here are the Threadline detector scores,
// which are SIMULATED: deterministic rules on a simulated company.
import type { Lane, Provenance, Seat, Tier } from "@vouch/module/types";

export const THESIS = "Trust sets the speed of money, and refunds are where it starts.";

export const LAYERS = [
  { n: 1, name: "Vouch the customer", does: "A stored, expiring Vouch Record for each customer and shopping agent: a tier from 0 to 3, the reasons, an expiry.", ai: "Credit Analyst (CREAO)" },
  { n: 2, name: "Refund more, sooner", does: "The refund ladder: Lane A instant under a cap, B part now and the rest on proof, C hold and verify, D stop.", ai: "Policy Engine (deterministic)" },
  { n: 3, name: "Check the claim", does: "A cited verdict for each contested claim, the policy clause, the source trusted, and photo reuse across accounts.", ai: "Refund Desk (CREAO) plus the refund risk model" },
  { n: 4, name: "Foundations for agent shoppers", does: "Agents register with a principal and a mandate; every order is a lookup of the same record; incidents are recorded.", ai: "Agent-Order Underwriter (CREAO)" },
] as const;

export const LANES: Record<Lane, { name: string; blurb: string }> = {
  A: { name: "Instant", blurb: "Full refund in seconds, under the tier cap." },
  B: { name: "Part now", blurb: "Part now, the rest when the return scans in." },
  C: { name: "Hold and verify", blurb: "One-step check. Never a denial." },
  D: { name: "Stop", blurb: "A person decides." },
};

export const TIER_LABELS: Record<Tier, string> = { 0: "New", 1: "Verified", 2: "Established", 3: "Vouched" };

export interface LadderRow { tier: string; who: string; lane: string; cap: string; happens: string }
export const LADDER: LadderRow[] = [
  { tier: "0", who: "New or unverifiable", lane: "C", cap: "None", happens: "Hold and verify with a one-step check" },
  { tier: "1", who: "Verified identity, thin history", lane: "B", cap: "None", happens: "Part now, the rest when the return scans in" },
  { tier: "2", who: "Established", lane: "A", cap: "$200", happens: "Full refund in seconds; above $200 falls to B" },
  { tier: "3", who: "Vouched", lane: "A", cap: "$1,000", happens: "Full refund in seconds; above $1,000 falls to B" },
  { tier: "Any", who: "Evidence cannot be verified", lane: "C", cap: "None", happens: "Hold and verify, never deny" },
  { tier: "Any", who: "Duplicate photo or incident on record", lane: "D", cap: "None", happens: "Stop; a person decides" },
];

export const SEATS: { seat: Seat; agent: string; role: string; asksPersonWhen: string }[] = [
  { seat: "credit_analyst", agent: "Credit Analyst", role: "Credit analyst, for people", asksPersonWhen: "A new customer with a large claim, or a limit increase" },
  { seat: "agent_order", agent: "Agent-Order Underwriter", role: "Credit analyst, for shopping agents", asksPersonWhen: "An order outside the mandate" },
  { seat: "refund_desk", agent: "Refund Desk", role: "Refund and dispute analyst", asksPersonWhen: "Lane C or D, an amount above the cap, or sources that disagree" },
  { seat: "reconciler", agent: "Reconciler", role: "Cash applier and reconciler", asksPersonWhen: "A break above materiality, or a cause it cannot establish" },
];

export interface ProofRow { detector: string; standard: string; heldOut: string }
export const PROOF: { standardSet: string; heldOutSet: string; rows: ProofRow[] } = {
  standardSet: "Seed 11: 64 planted refund errors, 2,532 orders",
  heldOutSet: "Seed 23: 70 planted refund errors, 2,623 orders",
  rows: [
    { detector: "Plain rules", standard: "Caught 58 of 64, 106 false alarms", heldOut: "Caught 63 of 70, 103 false alarms" },
    { detector: "Rules desk", standard: "Caught 64 of 64, 0 false alarms (tuned on this set)", heldOut: "Caught 63 of 70, 4 false alarms" },
  ],
};

export interface SourceRow { name: string; provenance: Provenance; note: string }
// Honest default: nothing is Live until a hello script has printed a real response.
export const SOURCES: SourceRow[] = [
  { name: "Threadline retailer (orders, refunds, books)", provenance: "simulated", note: "Generated with a fixed seed and an answer key (world/)" },
  { name: "Customers, claims, photos", provenance: "seeded", note: "Demo data loaded by npm run seed" },
  { name: "Speed-versus-loss curve", provenance: "simulated", note: "A simulation, moves with the merchant's dial" },
  { name: "Refund risk model", provenance: "simulated", note: "Trained on seed 11, tested on seed 23; unmeasured until ml/eval.py runs" },
  { name: "CRS identity result", provenance: "seeded", note: "Becomes Live when scripts/hello-crs.ts prints a real response" },
  { name: "Nessie payment history", provenance: "seeded", note: "Becomes Live when scripts/hello-nessie.ts works; otherwise Threadline tables stand in" },
  { name: "CREAO agent verdicts", provenance: "seeded", note: "Becomes Live when the worker calls the saved agents" },
];
