import { describe, expect, it } from 'vitest';
import { caseIdentity, identityVerified, stepUpTrigger, THIN_DAYS, THIN_PURCHASES, type CaseIdentity, type StepUpFacts } from '../src/identity';
import { fixtureScreening } from '../src/crs';
import { fixtureResponse } from '../src/fixtures';
import { identityLines } from '../src/review/prompts';

// The CRS identity step-up (docs/CRS.md): who gets screened, what the investigators see, and the
// rule that identity is context for a person, never a reason to decline.
const established: StepUpFacts = { kind: 'live', amountCents: 24_900, autoApproveLimitCents: 50_000, purchasesCompleted: 40, accountAgeDays: 400, credentialVerified: true };

describe('when a claim gets the CRS identity step-up', () => {
  it('screens thin histories, missing credentials, claims over the store limit and the showcase', () => {
    expect(stepUpTrigger(established)).toBeNull();
    expect(stepUpTrigger({ ...established, purchasesCompleted: THIN_PURCHASES - 1 })).toBe('thin_history');
    expect(stepUpTrigger({ ...established, accountAgeDays: THIN_DAYS - 1 })).toBe('thin_history');
    expect(stepUpTrigger({ ...established, credentialVerified: false })).toBe('no_credential');
    expect(stepUpTrigger({ ...established, amountCents: 64_900 })).toBe('over_limit');
    expect(stepUpTrigger({ ...established, kind: 'showcase' })).toBe('showcase');
  });
  it('a brand-new shopper on /shop is always screened (no history, no credential)', () => {
    expect(stepUpTrigger({ kind: 'live', amountCents: 24_900, autoApproveLimitCents: 50_000, purchasesCompleted: 1, accountAgeDays: 0, credentialVerified: false })).toBe('thin_history');
  });
});

const row = (personaId: 'P01' | 'P12' | 'P13' | 'P16') => {
  const s = fixtureScreening(personaId);
  return {
    personaId, source: s.source, trigger: 'thin_history', route: s.route, contactRiskScore: s.contactRiskScore ?? -1, contactRiskBand: s.contactRiskBand,
    identityStatus: s.identityStatus, messageCodes: JSON.stringify(s.messages.map((m) => m.code)), reasonsJson: JSON.stringify(s.reasons),
    checkedAt: { toDate: () => new Date('2026-10-25T12:00:00Z') },
  };
};

describe('what the investigators read', () => {
  it('a redacted screening: persona id, bands, codes and route, never identity data', () => {
    const id = caseIdentity(row('P12'), '');
    expect(id).toMatchObject({ status: 'screened', provider: 'CRS', persona: 'P12', route: 'merchant_identity_review', contact_risk_band: 'review', message_codes: ['2201', '2101'] });
    expect(JSON.stringify(id)).not.toMatch(/ssn|dob|email|street|\d{3}-\d{2}-\d{4}/i);
  });
  it('only a clean match counts as a verified identity', () => {
    expect(identityVerified(caseIdentity(row('P01'), ''))).toBe(true);
    for (const p of ['P12', 'P13', 'P16'] as const) expect(identityVerified(caseIdentity(row(p), ''))).toBe(false);
    expect(identityVerified({ status: 'not_run', reason: 'x' })).toBe(false);
  });
  it('the video reviewer\'s case file explains what the screening may and may not be used for', () => {
    const lines = identityLines(caseIdentity(row('P16'), '')).join('\n');
    expect(lines).toMatch(/route: additional verification/);
    expect(lines).toMatch(/never a reason to reject the claim on its own/);
    expect(identityLines({ status: 'not_run', reason: 'an established shopper' }).join('\n')).toMatch(/says nothing about the customer/);
  });
});

const invCase = (identity: CaseIdentity) => ({
  claim_id: 'C-1', amount_requested: 249, controller_threshold: 500, evidence: { unable_to_verify: false, challenge: { passed: true }, capture_flags: [] },
  deterministic_checks: { frame_reuse: [], within_window: true, still_image: false }, identity,
});
type Rec = { action: string; confidence: number; reasons: { text: string; cites: string }[] };

describe('the Refund Investigator cites CRS but never declines on it', () => {
  it('a clean match is cited as support and keeps the accept', () => {
    const r = fixtureResponse('refund_investigator', invCase(caseIdentity(row('P01'), ''))) as Rec;
    expect(r.action).toBe('accept');
    expect(r.reasons.find((x) => x.cites === 'identity:crs')?.text).toMatch(/matched/);
  });
  it('a discrepancy or a fraud alert lowers confidence so a person checks identity, and the action stays the same', () => {
    for (const p of ['P12', 'P13', 'P16'] as const) {
      const r = fixtureResponse('refund_investigator', invCase(caseIdentity(row(p), ''))) as Rec;
      expect(r.action).toBe('accept');
      expect(r.confidence).toBeLessThanOrEqual(0.6);
      expect(r.reasons.find((x) => x.cites === 'identity:crs')?.text).toMatch(/does not change the item decision/);
    }
  });
  it('the Risk Scorecard reads the screening as an identity indicator', () => {
    const card = fixtureResponse('risk_scorecard', { claim_id: 'C-1', history: {}, credential: {}, patterns: [], identity: caseIdentity(row('P01'), ''), item_context: {}, video_checks: {} }) as { indicators: { name: string; reading: string; cites: string }[] };
    expect(card.indicators.find((i) => i.name === 'identity')).toMatchObject({ reading: 'supports', cites: 'identity:crs' });
  });
});
