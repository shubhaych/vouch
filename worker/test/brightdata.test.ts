import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../src/env';
import { brightdataReady, fixtureListings, normalizeListings, normalizeSignals, searchListings, searchReturnSignals, takeScrapeBudget, unwrap } from '../src/brightdata';

// A recorded-shape Google Shopping answer from the SERP API (brd_json=1), once as the page and once wrapped by format=json.
const shoppingPage = {
  general: { search_engine: 'google', query: 'noise cancelling headphones' },
  shopping: [
    { title: 'Noise-cancelling headphones', price: '$249.00', currency: 'USD', source: 'Example Store', link: 'https://example.com/a', image: 'https://img/a.jpg', rating: 4.5, reviews: 1200 },
    { title: 'Over-ear headphones, matte black', extracted_price: 199, seller: 'Other Shop', url: 'https://example.com/b' },
    { price: '$5' }, // no title: dropped
  ],
  organic: [{ title: 'Headphones return policy', description: 'Returns within 30 days.', link: 'https://example.com/returns', display_link: 'example.com' }],
};

describe('Bright Data response normalisation', () => {
  it('unwraps a page, a JSON string and a format=json envelope', () => {
    expect(unwrap(shoppingPage)).toBe(shoppingPage);
    expect(unwrap(JSON.stringify(shoppingPage)).shopping).toHaveLength(3);
    expect(unwrap({ status_code: 200, body: JSON.stringify(shoppingPage) }).shopping).toHaveLength(3);
    expect(unwrap('not json')).toEqual({});
  });
  it('maps shopping rows to listings and drops rows without a title', () => {
    const l = normalizeListings(shoppingPage);
    expect(l).toHaveLength(2);
    expect(l[0]).toMatchObject({ title: 'Noise-cancelling headphones', price: 249, seller: 'Example Store', url: 'https://example.com/a', rating: 4.5, reviews: 1200 });
    expect(l[1]).toMatchObject({ price: 199, seller: 'Other Shop', currency: 'USD' });
  });
  it('maps organic rows to return signals', () => {
    expect(normalizeSignals(shoppingPage)).toEqual([{ title: 'Headphones return policy', snippet: 'Returns within 30 days.', url: 'https://example.com/returns', source: 'example.com' }]);
  });
});

describe('fixture mode', () => {
  it('builds listings from the catalogue with the ordered item first and a close variant second', () => {
    const l = fixtureListings('Wireless headphones');
    expect(l[0]!.title).toBe('Wireless headphones');
    expect(l[1]!.title).toContain('refurbished');
    expect(l.length).toBeGreaterThanOrEqual(4);
  });
  it('searchListings and searchReturnSignals say they are fixtures and carry no error', async () => {
    const a = await searchListings('Wireless earbuds');
    expect(a.source).toBe('fixture');
    expect(a.items[0]!.title).toBe('Wireless earbuds');
    expect(a.error).toBeNull();
    const b = await searchReturnSignals('Wireless earbuds');
    expect(b.source).toBe('fixture');
    expect(b.items.length).toBeGreaterThan(0);
  });
});

describe('live-mode guards', () => {
  const saved = { ...config.brightdata };
  afterEach(() => Object.assign(config.brightdata, saved));
  it('refuses to scrape without a token', () => {
    Object.assign(config.brightdata, { mode: 'live', token: '' });
    expect(brightdataReady()).toMatch(/BRIGHTDATA_API_TOKEN/);
  });
  it('stops at the daily limit', () => {
    config.brightdata.dailyLimit = 2;
    expect(takeScrapeBudget()).toBe(true);
    expect(takeScrapeBudget()).toBe(true);
    expect(takeScrapeBudget()).toBe(false);
  });
});
