// The Desk's policy, in one place: limits, the authority order, how a
// conditional second leg is treated, materiality and the exposure lines. The
// Proof screen prints this object as it is. The treatment of the second leg is
// a choice a controller should confirm, not a claim of GAAP compliance.

export type Source = 'processor' | 'bank' | 'warehouse' | 'decision_log' | 'ledger';
export type Rung = 'normal' | 'watch' | 'hedge' | 'pause';
export const RUNGS: readonly Rung[] = ['normal', 'watch', 'hedge', 'pause'];

export const POLICY = {
  version: 'desk-policy-1',
  /** An entry at or under this posts without a person, until the period cap is used up. */
  autoPostLimitCents: 100_000,
  /** Total auto-posted per company per period; above it every entry waits for the controller. */
  autoPostPeriodCapCents: 50_000_000,
  /**
   * System entries, not refund payments: the month-end accrual, its day-one reversal and the daily sales journal
   * from the processor's settled batch. They post without the per-entry limit; the controller signs them off by locking the period.
   */
  closeEntryKinds: ['accrue_leg2', 'reverse_accrual', 'sales_summary'] as readonly string[],
  /** A bridge line above this must be explained before a period can lock. */
  materialityCents: 5_000,
  /** Differences under this are rounding (planted class 8's decoys live under it). */
  roundingToleranceCents: 5,
  /** Who wins when sources disagree, per question. The ledger never wins: it is corrected. */
  authority: {
    cash_moved: 'processor',
    goods_returned: 'warehouse',
    refund_authorized: 'decision_log',
    settled: 'bank',
  } as Record<string, Source>,
  authorityWhy: {
    cash_moved: 'The processor moves the money; the ledger only records what we think happened.',
    goods_returned: 'Only the warehouse scan proves the item came back and in what condition.',
    refund_authorized: 'The Vouch decision log is the only record of who approved a refund, with its evidence.',
    settled: 'The bank statement is the final word on whether and when cash arrived or left.',
  } as Record<string, string>,
  /** Leg 2 of a conditional refund: accrued at month end at the expected completion rate, auto-reversed on day one. */
  leg2: { treatment: 'accrue_at_close_reverse_day_one' as const, clockDays: 30 },
  /** Bayesian smoothing of completion rates: Beta prior strength (pseudo-observations). */
  reserve: { priorStrength: 20, defaultRateBp: 8_000 },
  /** Exposure ladder lines, per signal, in basis points (1% = 100 bp) unless the name says otherwise. */
  exposure: {
    checkEveryHours: 6,
    expiryHours: { watch: 24, hedge: 72, pause: 72 },
    /** Under Hedge, the immediate leg in affected categories drops to this share and risky tiers move to return-first. */
    hedgeLeg1ShareBp: 5_000,
    signals: {
      refund_share_vs_baseline: { label: 'Refund dollars vs the company\'s own 7-day baseline', unit: '% of baseline', watch: 170_00, hedge: 240_00 },
      contradicted_rate: { label: 'Claims the video contradicts', unit: '% of claims', watch: 15_00, hedge: 25_00 },
      ring_concentration: { label: 'Refund dollars tied to flagged clusters (shared device, address or media)', unit: '% of refund $', watch: 10_00, hedge: 20_00 },
      leg1_exposure_vs_cash: { label: 'Unrecovered first-leg payouts vs cash available', unit: '% of cash', watch: 5_00, hedge: 10_00 },
      reserve_shortfall: { label: 'Reserve true-up shortfall vs the accrual', unit: '% of accrual', watch: 10_00, hedge: 25_00 },
      obligations_past_half: { label: 'Open return obligations past half their clock', unit: '% of open', watch: 55_00, hedge: 75_00 },
    },
  },
  /** Human minutes per exception, for the "would you hire it" comparison. An assumption, labelled as such. */
  assumedHumanMinutesPerException: 12,
} as const;

export type SignalKey = keyof typeof POLICY.exposure.signals;
export const SIGNAL_KEYS = Object.keys(POLICY.exposure.signals) as SignalKey[];
