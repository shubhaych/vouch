// The worker's privileged connections. It creates and saves its own identity
// token on first connect (git-ignored under worker/.keys/) and then claims
// its role with bootstrapWorker / bootstrapPoster, which the module allows
// once. Never log a token.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DbConnection } from '../module_bindings/index';
import { config, log } from './env';

export type Conn = DbConnection;
/** worker and poster claim their roles once; showcase is a third identity that takes the business seat for the home demo. */
export type Label = 'worker' | 'poster' | 'showcase' | 'accountant' | 'reconciler' | 'analyst';

// One token per server and database: a token issued by the local server is rejected by
// Maincloud (and the other way round), so switching servers must not reuse it.
const serverKey = `${new URL(config.stdbUri).host}-${config.stdbDb}`.replace(/[^a-z0-9.-]/gi, '_');
export const tokenFile = (label: Label) => resolve(config.keysDir, `stdb-${label}-${serverKey}-token`);

function savedToken(label: Label): string {
  if (label === 'worker' && config.stdbWorkerToken) return config.stdbWorkerToken;
  const f = tokenFile(label);
  return existsSync(f) ? readFileSync(f, 'utf8').trim() : '';
}

export interface Connected { conn: DbConnection; identity: string }

/**
 * Asks SpacetimeDB itself, not this connection's replica, whether a claim exists. The worker subscribes to
 * whole tables, so under a busy simulation its replica can trail the database by minutes; a phone that
 * uploads in that window must not be told its claim does not exist. Undefined when the database cannot be asked.
 */
export async function claimOnServer(claimId: bigint): Promise<boolean | undefined> {
  const base = config.stdbUri.replace(/^ws/, 'http').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/v1/database/${config.stdbDb}/sql`, {
      method: 'POST',
      headers: { authorization: `Bearer ${savedToken('worker')}` },
      body: `SELECT id FROM claim WHERE id = ${claimId}`,
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return undefined;
    const [result] = (await res.json()) as { rows?: unknown[] }[];
    return (result?.rows?.length ?? 0) > 0;
  } catch {
    return undefined;
  }
}

/** Connects, subscribes to `queries` plus the role table, and claims the role if this identity has none. */
export function connect(label: Label, queries: string[], timeoutMs = 30_000): Promise<Connected> {
  const saved = savedToken(label);
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`SpacetimeDB connect timed out (${config.stdbUri}/${config.stdbDb})`)), timeoutMs);
    DbConnection.builder()
      .withUri(config.stdbUri)
      .withDatabaseName(config.stdbDb)
      .withToken(saved || undefined)
      .withAutomaticReconnect()
      .onConnect((conn, identity, token) => {
        if (token && token !== saved && !(label === 'worker' && config.stdbWorkerToken)) {
          mkdirSync(config.keysDir, { recursive: true });
          writeFileSync(tokenFile(label), token, { mode: 0o600 });
        }
        const hex = identity.toHexString();
        conn
          .subscriptionBuilder()
          .onApplied(async () => {
            const mine = [...conn.db.role.iter()].find((r) => r.who.toHexString() === hex);
            if (!mine && label !== 'showcase') {
              try {
                if (label === 'worker') await conn.reducers.bootstrapWorker({});
                else if (label === 'poster') await conn.reducers.bootstrapPoster({});
                else await conn.reducers.bootstrapFinanceSeat({ seat: label });
                log(`${label} identity ${hex.slice(0, 12)}… claimed the ${label} role`);
              } catch (e) {
                log(`could not claim the ${label} role: ${(e as Error).message}. If another machine became the ${label} first, republish with --delete-data (demo data only).`);
              }
            } else if (mine && label !== 'showcase' && mine.role !== label) {
              log(`warning: this identity holds role ${mine.role}, expected ${label}`);
            }
            clearTimeout(timer);
            done({ conn, identity: hex });
          })
          .onError((ctx) => {
            const event = (ctx as { event?: unknown }).event;
            log(`${label} subscription error`, event ?? '');
            // A missing table means the database still runs an older module than this worker was built against.
            if (/no such table/.test(String((event as { message?: string })?.message ?? event))) {
              const message = `${label}: ${config.stdbUri}/${config.stdbDb} does not have the current Vouch schema. Publish module/ to this exact database, or point STDB_URI/STDB_DB at the database you published.`;
              log(message);
              clearTimeout(timer);
              conn.disconnect();
              fail(new Error(message));
            }
          })
          .subscribe(['SELECT * FROM role', ...queries]);
      })
      .onConnectError((_ctx, err) => {
        clearTimeout(timer);
        fail(err);
      })
      .onDisconnect(() => log(`${label} SpacetimeDB connection closed`))
      .build();
  });
}

/** Reducer errors arrive as rejected promises; log them with context instead of crashing the worker. */
export async function call<T>(what: string, p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    log(`reducer ${what} failed: ${(e as Error).message}`);
    return undefined;
  }
}
