// Creates a test shopper with a given history through the real reducers (a
// fresh identity joins, buys, fast-forwards and files refund claims), for the
// QA personas. Scores only move through real events, so --purchases and
// --refunds shape the history; the score follows from what happens next.
//   npx tsx scripts/make-agent.ts --purchases 10 --refunds 6 [--business 2]
import { writeFileSync, mkdirSync } from 'node:fs';
import { DbConnection } from '../worker/module_bindings/index';
import { CATALOG } from '../module/src/world';
import { loadEnv } from './_env';

loadEnv();
const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1]! : d; };
const purchases = Number(arg('purchases', '10'));
const refunds = Number(arg('refunds', '0'));
const businessId = Number(arg('business', '2'));
const uri = process.env.STDB_URI || 'ws://localhost:3011';
const dbName = process.env.STDB_DB || 'vouch';

const { conn, token } = await new Promise<{ conn: DbConnection; token: string }>((resolve, reject) => {
  DbConnection.builder().withUri(uri).withDatabaseName(dbName).onConnect((c, _id, token) => {
    c.subscriptionBuilder().onApplied(() => resolve({ conn: c, token })).subscribe(['SELECT * FROM my_agent', "SELECT * FROM purchase WHERE source = 'live'", 'SELECT * FROM claim']);
  }).onConnectError((_c, e) => reject(e)).build();
});
const wait = async <T>(f: () => T | undefined) => { for (let i = 0; i < 200; i++) { const v = f(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } throw new Error('timeout'); };
await conn.reducers.joinAsShopper({ name: `qa-${purchases}-${refunds}` });
const me = await wait(() => [...conn.db.myAgent.iter()][0]);
const items = CATALOG.filter((c) => c.category === 'electronics' && c.priceCents < 50_000);
const claims: { claimId: string; nonce: string; fingers: number }[] = [];
for (let i = 0; i < purchases; i++) {
  const before = new Set([...conn.db.purchase.iter()].map((p) => p.id));
  await conn.reducers.buy({ businessId, sku: items[i % items.length]!.sku });
  const p = await wait(() => [...conn.db.purchase.iter()].find((x) => x.buyer === me.agentId && !before.has(x.id)));
  await conn.reducers.fastForward({ purchaseId: p.id });
  if (i < refunds) {
    await conn.reducers.requestRefund({ purchaseId: p.id, reasonCode: 'defective', reasonText: 'It stopped working.' });
    const c = await wait(() => [...conn.db.claim.iter()].find((x) => x.agentId === me.agentId && !claims.some((k) => k.claimId === String(x.id))));
    claims.push({ claimId: String(c.id), nonce: c.nonce, fingers: c.fingerCount });
  }
}
mkdirSync('qa', { recursive: true });
const out = { agentId: me.agentId, label: `A-${me.agentId}`, token, claims };
writeFileSync(`qa/agent-${me.agentId}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ agentId: me.agentId, purchases, refunds, claims }, null, 2));
console.log(`identity token saved to qa/agent-${me.agentId}.json (test identity only)`);
conn.disconnect();
process.exit(0);
