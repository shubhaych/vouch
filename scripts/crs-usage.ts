// CRS usage straight from SpacetimeDB: requests by product, failures, claim screenings by route,
// simulated refunds routed, latest requests. Read-only (an anonymous subscription).
//   npx tsx scripts/crs-usage.ts
import { DbConnection } from '../worker/module_bindings/index';
import { loadEnv } from './_env';

loadEnv();
const uri = process.env.STDB_URI || 'ws://localhost:3011';
const db = process.env.STDB_DB || 'vouch';
const conn = await new Promise<DbConnection>((res, rej) => {
  DbConnection.builder().withUri(uri).withDatabaseName(db)
    .onConnect((c) => { c.subscriptionBuilder().onApplied(() => res(c)).subscribe(['SELECT * FROM crs_stat', 'SELECT * FROM crs_call', 'SELECT * FROM identity_screening']); })
    .onConnectError((_c, e) => rej(e)).build();
});
const s = conn.db.crsStat.id.find(1);
if (!s) { console.log(`${uri}/${db}: no CRS activity recorded yet`); process.exit(0); }
console.log(`${uri}/${db}`);
console.log(`requests to CRS: ${s.calls} (${s.failedCalls} failed)  by product ${s.productsJson}`);
console.log(`claim screenings: ${s.screenings} (${s.cachedScreenings} from cache)  by route ${s.routesJson}`);
console.log(`simulated refunds routed: ${s.simRefundsScreened}  by route ${s.simRoutesJson}`);
console.log(`last health: HTTP ${s.lastHealthStatus}`);
const recent = [...conn.db.identityScreening.iter()].sort((a, b) => Number(b.id - a.id)).slice(0, 5);
for (const r of recent) console.log(`  R-${r.refundId} ${r.trigger} ${r.personaId} ${r.source} → ${r.route}`);
conn.disconnect();
process.exit(0);
