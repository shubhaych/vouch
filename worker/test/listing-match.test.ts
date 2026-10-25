import { describe, expect, it } from 'vitest';
import { fixtureResponse } from '../src/fixtures';
import { guardListingMatch } from '../src/orchestrator';

const ok = { withinWindow: true, unableToVerify: false, listings: 3 };

describe('Listing Matcher guard', () => {
  it('only lets "ineligible" stand for a hard reason', () => {
    expect(guardListingMatch({ same_as_ordered: 'uncertain', confidence: 0.9, eligibility: { verdict: 'ineligible' } }, ok).eligibility!.verdict).toBe('needs_person');
    expect(guardListingMatch({ same_as_ordered: 'false', confidence: 0.9, eligibility: { verdict: 'ineligible' } }, ok).eligibility!.verdict).toBe('ineligible');
    expect(guardListingMatch({ same_as_ordered: 'false', confidence: 0.5, eligibility: { verdict: 'ineligible' } }, ok).eligibility!.verdict).toBe('needs_person');
    expect(guardListingMatch({ same_as_ordered: 'true', confidence: 0.9, eligibility: { verdict: 'ineligible' } }, { ...ok, withinWindow: false }).eligibility!.verdict).toBe('ineligible');
  });
  it('never calls a claim eligible on unverifiable frames, no listings or an uncertain match', () => {
    const eligible = { same_as_ordered: 'true', confidence: 0.9, eligibility: { verdict: 'eligible' } };
    expect(guardListingMatch(eligible, ok).eligibility!.verdict).toBe('eligible');
    expect(guardListingMatch(eligible, { ...ok, unableToVerify: true }).eligibility!.verdict).toBe('needs_person');
    expect(guardListingMatch(eligible, { ...ok, listings: 0 }).eligibility!.verdict).toBe('needs_person');
    expect(guardListingMatch({ ...eligible, same_as_ordered: 'uncertain' }, ok).eligibility!.verdict).toBe('needs_person');
  });
  it('normalises garbage', () => {
    const g = guardListingMatch({ same_as_ordered: 'yes', confidence: 7, eligibility: { verdict: 'approve' } }, ok);
    expect(g.same_as_ordered).toBe('uncertain');
    expect(g.confidence).toBe(1);
    expect(g.eligibility!.verdict).toBe('needs_person');
  });
});

const listing = (title: string) => ({ title, price: 10, currency: 'USD', seller: 'S', url: 'https://x.test/' + title, image: '', rating: null, reviews: null, snippet: '' });
const base = {
  claim_id: 'C-1', order: { item: 'Wireless earbuds', sku: 'SKU-1' }, policy: { notes: '' },
  evidence: { unable_to_verify: false, item_matches_reference: { value: 'true' }, defect_consistent_with_claim: { value: 'true' }, frames: [{ index: 0, observation: 'buds in case' }] },
  deterministic_checks: { within_window: true },
};

describe('Listing Matcher fixture', () => {
  it('matches the ordered item to its listing and calls it eligible', () => {
    const r = fixtureResponse('listing_matcher', { ...base, scraped_listings: { items: [listing('Smartwatch'), listing('Wireless earbuds')] } }) as { same_as_ordered: string; matched_listing: { index: number }; eligibility: { verdict: string } };
    expect(r.same_as_ordered).toBe('true');
    expect(r.matched_listing.index).toBe(1);
    expect(r.eligibility.verdict).toBe('eligible');
  });
  it('sends the claim to a person when there are no listings, and never declines', () => {
    const r = fixtureResponse('listing_matcher', { ...base, scraped_listings: { items: [], error: 'daily scrape limit (60) reached' } }) as { same_as_ordered: string; eligibility: { verdict: string; reasons: { cites: string }[] } };
    expect(r.same_as_ordered).toBe('uncertain');
    expect(r.eligibility.verdict).toBe('needs_person');
    expect(r.eligibility.reasons[0]!.cites).toBe('listings:none');
  });
  it('sends an out-of-window claim to a person rather than calling it ineligible', () => {
    const r = fixtureResponse('listing_matcher', { ...base, deterministic_checks: { within_window: false }, scraped_listings: { items: [listing('Wireless earbuds')] } }) as { eligibility: { verdict: string } };
    expect(r.eligibility.verdict).toBe('needs_person');
  });
});

describe('Returns Monitor fixture', () => {
  it('describes the window and flags exactly the spiking items', () => {
    const r = fixtureResponse('returns_monitor', {
      window: { seconds: 60, returns: 20, per_second: 0.33, baseline_per_second: 0.1 },
      items: [{ sku: 'SKU-1', name: 'Wireless earbuds', count: 12, per_second: 0.2, baseline_per_second: 0.02, spike: true, real_world: { source: 'fixture', signals: [{ url: 'https://r.test/a', title: 't' }] } }, { sku: 'SKU-2', name: 'Smartwatch', count: 3, per_second: 0.05, baseline_per_second: 0.05, spike: false }],
      businesses: [{ id: 'B-002', name: 'Circuit Yard', count: 15 }], cohorts: [],
    }) as { narrative: string; anomalies: { sku: string; kind: string }[]; items_to_watch: string[]; real_world_context: { urls: string[] }[] };
    expect(r.narrative).toContain('20 returns');
    expect(r.anomalies).toEqual([expect.objectContaining({ sku: 'SKU-1', kind: 'spike' })]);
    expect(r.items_to_watch).toEqual(['SKU-1']);
    expect(r.real_world_context[0]!.urls).toEqual(['https://r.test/a']);
  });
});
