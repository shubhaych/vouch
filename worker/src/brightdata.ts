// Bright Data client: the worker scrapes, the agents read. Two things are
// scraped (docs/BRIGHTDATA.md):
//   listings  Google Shopping through the SERP API, for the Listing Matcher
//   signals   web results about returns of an item, for the Returns Monitor
// Both go through POST https://api.brightdata.com/request with a zone name
// (shapes from Bright Data's docs, read Oct 24: {zone, url, format}; the SERP
// API returns parsed JSON when the Google URL carries brd_json=1).
// Every result says where it came from and when. Fixture mode builds listings
// from the catalogue so the flow runs with no token. Failures return an empty
// result with an error line: an agent that sees no listings says "uncertain",
// never "ineligible".
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOG, type CatalogItem } from '@vouch/module/world';
import { config, log } from './env';

const API = process.env.BRIGHTDATA_API_BASE || 'https://api.brightdata.com/request';

export interface Listing {
  title: string;
  price: number | null; // dollars
  currency: string;
  seller: string;
  url: string;
  image: string;
  rating: number | null;
  reviews: number | null;
  snippet: string;
}
export interface Signal { title: string; snippet: string; url: string; source: string }
export interface Scrape<T> {
  kind: 'listings' | 'signals';
  query: string;
  source: 'brightdata' | 'fixture';
  fetchedAt: string;
  cached: boolean;
  items: T[];
  error: string | null;
}

// ---- normalisation (pure; unit tested against recorded SERP shapes)

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const n = Number(v.replace(/[^0-9.]/g, '')); return Number.isFinite(n) && v.trim() !== '' ? n : null; }
  return null;
};
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** The SERP API answers with the parsed page, sometimes wrapped as {status_code, body: "<json>"} by format=json. */
export function unwrap(raw: unknown): Record<string, unknown> {
  let v: unknown = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return {}; } }
  if (v && typeof v === 'object' && typeof (v as { body?: unknown }).body === 'string') {
    try { v = JSON.parse((v as { body: string }).body); } catch { return {}; }
  }
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** Google Shopping results come in a "shopping" array; a plain search carries shopping cards under the same name. */
export function normalizeListings(raw: unknown): Listing[] {
  const page = unwrap(raw);
  const rows = (Array.isArray(page.shopping) ? page.shopping : Array.isArray(page.popular_products) ? page.popular_products : []) as Record<string, unknown>[];
  return rows.map((r) => ({
    title: str(r.title ?? r.name),
    price: num(r.price ?? r.extracted_price ?? (r.offer as { price?: unknown } | undefined)?.price),
    currency: str(r.currency) || 'USD',
    seller: str(r.seller ?? r.source ?? r.merchant ?? (r.store as { name?: unknown } | undefined)?.name),
    url: str(r.link ?? r.url ?? r.product_link),
    image: str(r.image ?? r.thumbnail),
    rating: num(r.rating),
    reviews: num(r.reviews ?? r.reviews_cnt ?? r.ratings),
    snippet: str(r.snippet ?? r.description),
  })).filter((l) => l.title);
}

export function normalizeSignals(raw: unknown): Signal[] {
  const page = unwrap(raw);
  const rows = (Array.isArray(page.organic) ? page.organic : []) as Record<string, unknown>[];
  return rows.map((r) => ({
    title: str(r.title), snippet: str(r.description ?? r.snippet), url: str(r.link ?? r.url), source: str(r.display_link ?? r.source) || hostOf(str(r.link ?? r.url)),
  })).filter((s) => s.title && s.url);
}

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// ---- cache and budget

const cachePath = (kind: string, query: string) => resolve(config.brightdata.cacheDir, `${kind}-${createHash('sha1').update(query.toLowerCase()).digest('hex').slice(0, 16)}.json`);

function readCache<T>(kind: string, query: string): Scrape<T> | null {
  const p = cachePath(kind, query);
  if (!existsSync(p)) return null;
  try {
    const s = JSON.parse(readFileSync(p, 'utf8')) as Scrape<T>;
    if (Date.now() - Date.parse(s.fetchedAt) > config.brightdata.cacheHours * 3_600_000) return null;
    return { ...s, cached: true };
  } catch { return null; }
}

function writeCache(s: Scrape<unknown>) {
  try { mkdirSync(config.brightdata.cacheDir, { recursive: true }); writeFileSync(cachePath(s.kind, s.query), JSON.stringify(s)); } catch (e) { log('brightdata cache write failed', (e as Error).message); }
}

let usedToday = 0;
let today = new Date().toDateString();
/** One daily budget for every scrape; cache hits do not count. */
export function takeScrapeBudget(): boolean {
  const d = new Date().toDateString();
  if (d !== today) { today = d; usedToday = 0; }
  if (usedToday >= config.brightdata.dailyLimit) return false;
  usedToday++;
  return true;
}
export const scrapesUsedToday = () => usedToday;

/** What is missing before a live scrape can run, or null when ready. */
export function brightdataReady(): string | null {
  if (config.brightdata.mode !== 'live') return null;
  if (!config.brightdata.token) return 'BRIGHTDATA_API_TOKEN is empty';
  return null;
}

// ---- the request

async function request(zone: string, url: string): Promise<unknown> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.brightdata.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone, url, format: 'raw' }),
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  // Never echo the token or the whole page into a log line.
  if (!res.ok) throw new Error(`Bright Data ${res.status}: ${text.slice(0, 160).replace(/\s+/g, ' ')}`);
  return text;
}

const googleUrl = (q: string, params: Record<string, string>) => {
  const u = new URL('https://www.google.com/search');
  u.searchParams.set('q', q);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('brd_json', '1');
  return u.toString();
};

async function scrape<T>(kind: Scrape<T>['kind'], query: string, url: string, normalize: (raw: unknown) => T[], fixture: () => T[]): Promise<Scrape<T>> {
  const hit = readCache<T>(kind, query);
  if (hit) return hit;
  const base = { kind, query, fetchedAt: new Date().toISOString(), cached: false, error: null as string | null };
  if (config.brightdata.mode === 'fixture') return { ...base, source: 'fixture', items: fixture() };
  const notReady = brightdataReady();
  if (notReady) return { ...base, source: 'brightdata', items: [], error: notReady };
  if (!takeScrapeBudget()) return { ...base, source: 'brightdata', items: [], error: `daily scrape limit (${config.brightdata.dailyLimit}) reached` };
  try {
    const items = normalize(await request(config.brightdata.serpZone, url));
    const out: Scrape<T> = { ...base, source: 'brightdata', items };
    writeCache(out);
    log(`brightdata ${kind} "${query}": ${items.length} result(s)`);
    return out;
  } catch (e) {
    log(`brightdata ${kind} "${query}" failed: ${(e as Error).message}`);
    return { ...base, source: 'brightdata', items: [], error: (e as Error).message };
  }
}

/** Listings that look like the item, for the Listing Matcher. Google Shopping (udm=28). */
export const searchListings = (query: string, max = 8) =>
  scrape<Listing>('listings', query, googleUrl(query, { udm: '28', hl: 'en', gl: 'us' }), (raw) => normalizeListings(raw).slice(0, max), () => fixtureListings(query).slice(0, max));

/** Web results about returns and defects of an item, for the Returns Monitor. Descriptive context, never a rate. */
export const searchReturnSignals = (item: string, max = 5) => {
  const q = `"${item}" returns OR refund OR defective OR recall reviews`;
  return scrape<Signal>('signals', q, googleUrl(q, { hl: 'en', gl: 'us', num: '10' }), (raw) => normalizeSignals(raw).slice(0, max), () => fixtureSignals(item).slice(0, max));
};

// ---- fixture mode: deterministic listings built from the catalogue, labelled Fixture by every reader

function wordsOverlap(a: string, b: string) {
  const w = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2));
  const A = w(a); const B = w(b);
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return n;
}

/** The ordered item as its own listing, a close variant, and the catalogue's nearest other items. */
export function fixtureListings(query: string): Listing[] {
  const items: CatalogItem[] = [...CATALOG].sort((a, b) => wordsOverlap(query, `${b.name} ${b.description}`) - wordsOverlap(query, `${a.name} ${a.description}`));
  const best = items[0];
  if (!best) return [];
  const dollars = best.priceCents / 100;
  const mk = (title: string, price: number, seller: string, snippet: string, slug: string): Listing => ({
    title, price: Math.round(price * 100) / 100, currency: 'USD', seller, url: `https://example-shop.test/${slug}`, image: '', rating: 4.4, reviews: 318, snippet,
  });
  return [
    mk(best.name, dollars, 'Example Store', best.description, `sku-${best.sku}`),
    mk(`${best.name} (refurbished)`, dollars * 0.72, 'Example Outlet', `${best.description}. Certified refurbished, 90-day warranty.`, `sku-${best.sku}-refurb`),
    ...items.slice(1, 4).map((it) => mk(it.name, it.priceCents / 100, 'Example Marketplace', it.description, `sku-${it.sku}`)),
  ];
}

export function fixtureSignals(item: string): Signal[] {
  return [
    { title: `${item} review: what owners say after 3 months`, snippet: `Most reviews praise the ${item.toLowerCase()}; a minority mention a part that stopped working and a smooth return.`, url: 'https://example-reviews.test/' + item.toLowerCase().replace(/\W+/g, '-'), source: 'example-reviews.test' },
    { title: `Return policy for ${item}`, snippet: 'Returns accepted within 30 days in original condition; defective units replaced free.', url: 'https://example-shop.test/returns', source: 'example-shop.test' },
  ];
}
