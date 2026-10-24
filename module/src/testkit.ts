// Test helpers: an in-process module with init run and named identities.
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import { ConnectionId } from 'spacetimedb';
import { spacetimedb } from './schema';
import * as mod from './index';
import { initImpl } from './economy';
import type { Ctx } from './ctx';

let conn = 1n;
export const who = (sub: string) =>
  TestAuth.fromJwtPayload(JSON.stringify({ iss: 'vouch-test', sub, aud: ['spacetimedb'], iat: 0, exp: 4102444800 }), new ConnectionId(conn++));

export function harness() {
  const h = createModuleTestHarness(spacetimedb, mod);
  h.withReducerTx(TestAuth.internal(), (ctx) => initImpl(ctx as unknown as Ctx));
  const as = <T>(auth: ReturnType<typeof who>, body: (ctx: Ctx) => T): T => h.withReducerTx(auth, (ctx) => body(ctx as unknown as Ctx));
  return { h, as, db: h.db };
}
