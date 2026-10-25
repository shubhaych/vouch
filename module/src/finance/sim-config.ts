// Constants of the 100-company portfolio simulation (the prompt's sim.json).
// Every number here is a design target or a demo setting, printed on the Proof
// screen; the realised numbers are measured from the rows and shown beside them.

export const SIM = {
  /** Simulated hour 0 is midnight UTC on 1 July 2026. */
  epochMs: Date.UTC(2026, 6, 1),
  /** Orders across all 100 companies per simulated 30 days (about 2.5 per shopper agent). */
  ordersPerMonth: 25_000,
  /**
   * Share of refund claims that are fraudulent: a DEMO SETTING chosen so the
   * detector's work is visible. Industry reporting puts fraudulent returns
   * lower (verify before quoting any figure).
   */
  fraudShareBp: 1_500,
  /** Hidden kind of a shopper (from the main world's agent_truth) scales how likely their claim is fraudulent. */
  kindFraudMult: { honest: 0.8, opportunist: 1.5, serial: 2, ring: 2, live: 0.5, showcase: 0.5 } as Record<string, number>,
  fraudArchetypes: ['wardrobing', 'empty_box', 'contradicted_damage', 'return_swap', 'serial_claimer', 'friendly_chargeback'] as const,
  legitPersonas: ['casual', 'frequent', 'deal_hunter', 'bracketing', 'gift_buyer', 'honest_damage', 'late_returner'] as const,
  /** Probability the video contradicts the claim, per archetype (honest shoppers are sometimes contradicted too: lighting, wrong angle). */
  contradictedBp: { wardrobing: 3_000, empty_box: 5_000, contradicted_damage: 8_500, return_swap: 2_000, serial_claimer: 4_000, friendly_chargeback: 1_000, ring: 7_000, legit: 500 } as Record<string, number>,
  /** Probability the claim shares a device, address or media hash with other claims. */
  hashReuseBp: { ring: 9_000, fraud: 4_000, legit: 300 },
  /** Share of flags that become an investigation, and of investigated frauds the investigation verifies. */
  investigateBp: 6_000,
  verifyFraudBp: 4_200,
  /** Tiering for paid claims: full now up to T1, split above, return-first for big tickets. */
  t1MaxCents: 5_000,
  t3MinCents: 30_000,
  leg1ShareBp: 7_000,
  /** Return behaviour after a T2/T3 decision (basis points of obligations). */
  legitReturn: { intactBp: 8_500, lateBp: 700 }, // the rest never come back
  fraudReturn: { intactBp: 1_500, swapBp: 2_500 }, // the rest never come back
  costShareBp: 4_200, // cost of goods as a share of price
  feeBp: 290, // processor fee on sales (not returned on a refund)
  startingCashPerSizeCents: 6_000_000, // each company's opening cash, times its size
  /** Real-time pacing. One tick is hoursPerTick simulated hours. */
  tickMs: 500,
  turboHours: 24,
  prewarmDays: 90,
  /** Signals look at the last 24 hours against the last 7 days; fewer claims than this in 24 h is too thin to call. */
  minClaims24h: 8,
} as const;

/** Day-of-week (Sunday first) and hour-of-day shape of traffic, both averaging about 1. */
export const DOW = [1.15, 0.95, 0.9, 0.9, 0.95, 1.05, 1.1];
export const HOUR_CURVE = [0.3, 0.2, 0.15, 0.15, 0.2, 0.35, 0.6, 0.9, 1.1, 1.2, 1.25, 1.3, 1.35, 1.3, 1.25, 1.25, 1.3, 1.4, 1.55, 1.65, 1.6, 1.4, 1.0, 0.6];
