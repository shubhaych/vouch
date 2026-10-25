import { describe, expect, it } from 'vitest';
import { fixtureScreening, normalize, readMessages } from '../src/crs';

// CRS routes a case to a person or the investigator; it never approves or declines a refund.
describe('CRS identity screening', () => {
  it('routes the four sandbox personas as documented', () => {
    expect(fixtureScreening('P01').route).toBe('refund_investigator');
    expect(fixtureScreening('P12').route).toBe('merchant_identity_review');
    expect(fixtureScreening('P13').route).toBe('merchant_identity_review');
    expect(fixtureScreening('P16').route).toBe('additional_verification');
  });
  it('treats a missing idManagerVerification as unavailable, never a match', () => {
    expect(readMessages({ addOnProducts: [{}] })).toBeNull();
    const r = normalize('P01', 'sandbox', { risk: { score: 5 } }, { addOnProducts: [{}] });
    expect(r.identityStatus).toBe('unavailable');
    expect(r.route).toBe('additional_verification');
  });
  it('an empty messages array is a match', () => {
    expect(normalize('P01', 'sandbox', { risk: { score: 5 } }, { addOnProducts: [{ idManagerVerification: { messages: [] } }] }).identityStatus).toBe('match');
  });
  it('a failed call asks for more proof instead of flagging the shopper', () => {
    const r = normalize('P12', 'sandbox', null, null, ['Fraud Finder: timeout']);
    expect(r.contactRiskBand).toBe('unavailable');
    expect(r.route).toBe('additional_verification');
  });
});
