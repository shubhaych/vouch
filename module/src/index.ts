import { ScheduleAt, SyncResponse, Router } from 'spacetimedb/server';
import { spacetimedb, nightly } from './schema';
import { upsertConfig } from './settings';
import { DEFAULT_POLICY } from './types';

// SpacetimeDB reads reducers from this entry file's exports, so every area
// re-exports here. Add a new reducer file, then add a line below.
export * from './desk';
export * from './claims';
export * from './vouch';
export * from './agents';
export * from './settings';

export default spacetimedb;

// Starts the 24-hour schedule and seeds defaults on first publish.
export const onInit = spacetimedb.init((ctx) => {
  ctx.db.nightly.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(24n * 60n * 60n * 1_000_000n) });
  upsertConfig(ctx, 'creao_enabled', 'true');
  ctx.db.merchantPolicy.insert({ merchantId: 'threadline', policyJson: JSON.stringify(DEFAULT_POLICY), updatedAt: ctx.timestamp });
});

// The worker subscribes to `config` and starts a Reconciler run when this key moves.
export const runNightly = spacetimedb.reducer({ onSchedule: nightly }, { scheduledMessage: nightly.rowType }, (ctx) => {
  upsertConfig(ctx, 'nightly_tick', String(ctx.timestamp.microsSinceUnixEpoch));
});

const health = spacetimedb.httpHandler((_ctx, _req) => new SyncResponse('ok', { status: 200 }));
export const routes = spacetimedb.httpRouter(new Router().get('/health', health));
