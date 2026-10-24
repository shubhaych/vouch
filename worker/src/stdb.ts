// The worker's privileged connections. It creates and saves its own identity
// token on first connect (git-ignored under worker/.keys/) and then claims
// its role with bootstrapWorker / bootstrapPoster, which the module allows
// once. Never log a token.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DbConnection } from '../module_bindings/index';
import { config, log } from './env';

export type Conn = DbConnection;
export type Label = 'worker' | 'poster';

const tokenFile = (label: Label) => resolve(config.keysDir, `stdb-${label}-token`);

function savedToken(label: Label): string {
  if (label === 'worker' && config.stdbWorkerToken) return config.stdbWorkerToken;
  const f = tokenFile(label);
  return existsSync(f) ? readFileSync(f, 'utf8').trim() : '';
}

export interface Connected { conn: DbConnection; identity: string }

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
            if (!mine) {
              try {
                if (label === 'worker') await conn.reducers.bootstrapWorker({});
                else await conn.reducers.bootstrapPoster({});
                log(`${label} identity ${hex.slice(0, 12)}… claimed the ${label} role`);
              } catch (e) {
                log(`could not claim the ${label} role: ${(e as Error).message}. If another machine became the ${label} first, republish with --delete-data (demo data only).`);
              }
            } else if (mine.role !== label) {
              log(`warning: this identity holds role ${mine.role}, expected ${label}`);
            }
            clearTimeout(timer);
            done({ conn, identity: hex });
          })
          .onError((ctx) => log(`${label} subscription error`, (ctx as { event?: unknown }).event ?? ''))
          .subscribe(['SELECT * FROM role', ...queries]);
      })
      .onConnectError((_ctx, err) => {
        clearTimeout(timer);
        fail(err);
      })
      .onDisconnect(() => log(`${label} disconnected from SpacetimeDB; reconnecting`))
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
