// The ledger poster: a second worker identity with the `poster` role. It
// posts a balanced journal entry for every accepted decision. The module
// refuses the post if this identity also proposed or decided, or if the
// lines do not balance to the accepted amount.
import type { DbConnection } from '../module_bindings/index';
import type { Decision } from '../module_bindings/types';
import { log } from './env';
import { call } from './stdb';
import { label } from './history';

export class Poster {
  private done = new Set<bigint>();
  constructor(private conn: DbConnection) {}

  start() {
    this.conn.db.decision.onInsert((_c, d) => void this.maybePost(d));
    this.conn.db.decision.onUpdate((_c, _o, d) => void this.maybePost(d));
    for (const d of this.conn.db.decision.iter()) void this.maybePost(d);
    log('ledger poster ready');
  }

  private async maybePost(d: Decision) {
    if (d.status !== 'decided' || d.finalAction !== 'accept' || this.done.has(d.id)) return;
    this.done.add(d.id);
    const credit = d.method === 'store_credit' ? '2300 Store credit liability' : '1000 Cash';
    const memo = `Refund ${label.refund(d.refundId)} accepted (decision D-${d.id}): ${d.method.replace('_', ' ')}`;
    const ok = await call('post', this.conn.reducers.post({
      decisionId: d.id, memo,
      lines: [{ account: '4100 Refunds and returns', cents: BigInt(d.finalAmount) }, { account: credit, cents: -BigInt(d.finalAmount) }],
    }));
    if (ok !== undefined) log(`posted journal entry for D-${d.id}: $${(d.finalAmount / 100).toFixed(2)}`);
  }
}
