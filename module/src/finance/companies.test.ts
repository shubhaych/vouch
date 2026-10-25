import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPANIES, COMPANY_CATEGORIES } from './companies';

// The seed's inspiredBy names the real company each parody is drawn from. It is
// internal only: no generated file, page or public table may carry it.
const seed = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../seed/companies.seed.json'), 'utf8')) as { companies: { inspiredBy: string; slug: string }[] };
const internal = seed.companies.map((c) => c.inspiredBy).filter((v) => v && v !== '(house brand)');

describe('the 100 partner companies', () => {
  it('loads 100 companies, 400 products, unique slugs and skus, Brindle featured', () => {
    expect(COMPANIES).toHaveLength(100);
    expect(new Set(COMPANIES.map((c) => c.slug)).size).toBe(100);
    expect(new Set(COMPANIES.flatMap((c) => c.products.map((p) => p.sku))).size).toBe(400);
    expect(COMPANIES.filter((c) => c.featured).map((c) => c.slug)).toEqual(['brindle-and-co']);
    for (const c of COMPANIES) expect(COMPANY_CATEGORIES[c.category]).toBeDefined();
  });

  it('carries no inspiredBy value anywhere in the generated catalog', () => {
    const generated = readFileSync(resolve(import.meta.dirname, 'companies.ts'), 'utf8');
    expect(generated).not.toContain('inspiredBy');
    // Whole-word, case-sensitive: "Apple" must not appear, while a product like "Snapple" would not count.
    const leaked = internal.filter((name) => new RegExp(`(^|[^A-Za-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z]|$)`).test(generated));
    expect(leaked).toEqual([]);
  });
});
