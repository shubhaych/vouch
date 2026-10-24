// Honesty check: every number on a page sits next to a provenance badge
// (Live, Simulated, Fixture, Replay of real run). Loads each page in headless
// Chromium against the running app and lists numbers with no badge nearby.
//   npx tsx scripts/check-badges.ts [baseUrl]
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright') as typeof import('playwright');
const base = process.argv[2] ?? 'http://localhost:3000';
const pages = ['/', '/world', '/system', '/shop', '/business', '/lab'];
// Numbers that are labels, not data: ids, days in prose, prices in the catalogue, SKUs, years.
const EXEMPT = /^(A-|B-|C-|R-|P-|FR-|CE-|VC-|SKU|Day |day |d\d|Job |v\d|#|\$\d[\d,.]*$|\d+(px|ms|s|%)$)/;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let bad = 0;
for (const path of pages) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  const offenders = await page.evaluate((exempt) => {
    const re = new RegExp(exempt);
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode as Text;
      const text = (n.textContent ?? '').trim();
      if (!/^\$?[\d][\d,.]*%?$/.test(text) || text.length < 2) continue; // standalone figures only
      const el = n.parentElement!;
      if (el.closest('[data-prov], .badge, svg, select, option, code, pre, .font-mono, [aria-hidden="true"]')) continue;
      if (re.test(text)) continue;
      let host: Element | null = el;
      let found = false;
      for (let i = 0; i < 5 && host; i++, host = host.parentElement) if (host.querySelector('[data-prov]')) { found = true; break; }
      if (!found) out.push(`${text} in <${el.tagName.toLowerCase()} class="${el.className}">`);
    }
    return out.slice(0, 20);
  }, EXEMPT.source);
  bad += offenders.length;
  console.log(`${path}: ${offenders.length ? `${offenders.length} unbadged numbers\n  ${offenders.join('\n  ')}` : 'ok'}`);
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
