// The featured company's 12-month refund book in DuckDB: 1,000,000 orders and
// five systems that each hold part of the truth and disagree on purpose.
//
//   orders      the shop (what was sold, to whom, at what price and cost)
//   decisions   the Vouch decision log (tier, legs, score, band, formula, evidence)
//   proc        the payment processor (refunds, manual support refunds, chargebacks)
//   bank        the bank (settlement of each processor refund)
//   wms         the warehouse (return scans: condition and quantity)
//   ledger      our books, derived from the others by the posting rules
//
// Ten exception classes are planted, each with a decoy that looks alike and is
// fine. grader_truth holds the answer key and only score.ts reads it. Every
// random draw is hash(seed, row, purpose): the same seed rebuilds the same book.
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

export const BOOK_ORDERS = 1_000_000;
export const LIVE_ORDER_ID = 1_000_001;
export const BOOK_START = '2025-10-01';
export const BOOK_MONTHS = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const MONTH_WEIGHT = [0.07, 0.1, 0.13, 0.07, 0.06, 0.07, 0.07, 0.08, 0.08, 0.08, 0.09, 0.1];

export interface PlantClass { id: number; key: string; title: string; decoy: string; winner: string; planted: number; decoys: number }
export const CLASSES: PlantClass[] = [
  { id: 1, key: 'duplicate_refund', title: 'Duplicate refund (support refunded in the processor, Vouch refunded too)', decoy: 'two refunds for two different items on one order', winner: 'processor (cash) and decision log (authorization)', planted: 60, decoys: 90 },
  { id: 2, key: 'never_settled', title: 'Ledger says settled, the processor never paid it', decoy: 'slow settlement inside the 10-day window', winner: 'processor', planted: 60, decoys: 90 },
  { id: 3, key: 'missing_in_ledger', title: 'Settled at the processor, missing from the ledger', decoy: 'booked in the next period on purpose', winner: 'processor, then the period rule', planted: 60, decoys: 90 },
  { id: 4, key: 'chargeback_after_refund', title: 'Chargeback after a refund (double loss)', decoy: 'dispute on a different, unrefunded order', winner: 'processor', planted: 60, decoys: 90 },
  { id: 5, key: 'leg2_no_goods', title: 'Leg 2 released, item never received', decoy: 'carrier scan late, item arrived', winner: 'warehouse', planted: 60, decoys: 90 },
  { id: 6, key: 'failed_inspection', title: 'Returned item fails inspection (wrong or damaged vs the video)', decoy: 'packaging wear only', winner: 'warehouse, video as evidence', planted: 60, decoys: 90 },
  { id: 7, key: 'posted_to_prior_period', title: 'Return booked into the period before its scan (after the lock)', decoy: 'return inside the open period', winner: 'period rule', planted: 60, decoys: 90 },
  { id: 8, key: 'rounding', title: 'Rounding or currency mismatch above tolerance', decoy: 'difference under the 5-cent tolerance', winner: 'bank', planted: 60, decoys: 90 },
  { id: 9, key: 'fee_in_returns', title: 'Processor fee booked into returns', decoy: 'fee correctly expensed', winner: 'processor', planted: 60, decoys: 90 },
  { id: 10, key: 'partial_bundle', title: 'Partial return of a bundle, full second leg paid', decoy: 'full return of the same bundle', winner: 'warehouse', planted: 60, decoys: 90 },
];

export async function openBook(path: string, readOnly = false): Promise<DuckDBConnection> {
  const db = await DuckDBInstance.create(path, readOnly ? { access_mode: 'READ_ONLY' } : {});
  return db.connect();
}

export const rows = async <T>(c: DuckDBConnection, sql: string): Promise<T[]> =>
  (await c.runAndReadAll(sql)).getRowObjects().map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v && typeof v === 'object' && 'toString' in v && !Array.isArray(v) ? String(v) : v])) as T);

/** Builds the whole book. About ten seconds on a laptop. */
export async function generateBook(path: string, seed = 1): Promise<{ ms: number; counts: Record<string, number> }> {
  const t0 = Date.now();
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) rmSync(path);
  if (existsSync(`${path}.wal`)) rmSync(`${path}.wal`);
  const c = await openBook(path);
  const S = Math.floor(seed);
  // u(x, k): a uniform draw in [0, 1) for row x and purpose k.
  const u = (x: string, k: number) => `((hash(${S}, ${x}, ${k}) % 1000000)::DOUBLE / 1000000)`;
  let lo = 0;
  const months = BOOK_MONTHS.map((m, i) => { const r = { m, lo, hi: lo + MONTH_WEIGHT[i]! }; lo += MONTH_WEIGHT[i]!; return r; });
  await c.run(`CREATE TABLE months AS SELECT * FROM (VALUES ${months.map((m) => `('${m.m}', DATE '${m.m}-01', ${m.lo}, ${m.hi})`).join(',')}) t(period, first_day, lo, hi)`);
  await c.run(`CREATE TABLE products AS SELECT * FROM (VALUES ('brindle-and-co-1', 'Wool throw blanket', 6800, 1, 0.30), ('brindle-and-co-2', '16-piece dinner set', 12900, 3, 0.25), ('brindle-and-co-3', 'Linen duvet cover', 14900, 1, 0.20), ('brindle-and-co-4', 'Brass table lamp', 8900, 1, 0.25)) t(sku, name, price_cents, pieces, weight)`);

  // The shop: 1,000,000 orders, seasonal (December peaks), four products, 120,000 customers.
  await c.run(`CREATE TABLE orders AS
    WITH base AS (SELECT i AS order_id, ${u('i', 1)} AS um, ${u('i', 2)} AS ud, ${u('i', 3)} AS us, (hash(${S}, i, 4) % 120000)::INT + 1 AS customer_id FROM range(1, ${BOOK_ORDERS + 1}) t(i))
    SELECT b.order_id, m.period, (m.first_day + (FLOOR(b.ud * (DATE_DIFF('day', m.first_day, m.first_day + INTERVAL 1 MONTH)))::INT)) AS day,
      CASE WHEN b.us < 0.30 THEN 'brindle-and-co-1' WHEN b.us < 0.55 THEN 'brindle-and-co-2' WHEN b.us < 0.75 THEN 'brindle-and-co-3' ELSE 'brindle-and-co-4' END AS sku,
      b.customer_id
    FROM base b JOIN months m ON b.um >= m.lo AND b.um < m.hi`);
  await c.run(`ALTER TABLE orders ADD COLUMN price_cents INT; ALTER TABLE orders ADD COLUMN cost_cents INT; ALTER TABLE orders ADD COLUMN qty INT; ALTER TABLE orders ADD COLUMN fee_cents INT`);
  await c.run(`UPDATE orders o SET price_cents = p.price_cents, cost_cents = (p.price_cents * 42) // 100, qty = p.pieces, fee_cents = (p.price_cents * 29 + 50) // 1000 FROM products p WHERE p.sku = o.sku`);

  // The Vouch decision log: about 8% of orders get a refund decision.
  await c.run(`CREATE TABLE decisions AS
    SELECT 'D-' || o.order_id AS decision_id, o.order_id, (o.day + (3 + FLOOR(${u('o.order_id', 11)} * 20))::INT) AS day,
      CASE WHEN ${u('o.order_id', 12)} < 0.40 THEN 'T1' WHEN ${u('o.order_id', 12)} < 0.80 THEN 'T2' ELSE 'T3' END AS tier,
      o.price_cents AS amount_cents, o.qty AS authorized_qty,
      'review-v1' AS formula_version, (350 + FLOOR(${u('o.order_id', 13)} * 500))::INT AS score,
      'A-' || o.order_id || '-1,A-' || o.order_id || '-2' AS evidence_ids
    FROM orders o WHERE ${u('o.order_id', 10)} < 0.08`);
  await c.run(`DELETE FROM decisions WHERE day > DATE '2026-09-30'`);
  await c.run(`ALTER TABLE decisions ADD COLUMN leg1_cents INT; ALTER TABLE decisions ADD COLUMN leg2_cents INT; ALTER TABLE decisions ADD COLUMN band VARCHAR`);
  await c.run(`UPDATE decisions SET leg1_cents = CASE tier WHEN 'T1' THEN amount_cents WHEN 'T2' THEN (amount_cents * 7) // 10 ELSE 0 END,
    leg2_cents = amount_cents - CASE tier WHEN 'T1' THEN amount_cents WHEN 'T2' THEN (amount_cents * 7) // 10 ELSE 0 END,
    band = CASE WHEN score >= 750 THEN 'trusted' WHEN score >= 600 THEN 'good' WHEN score >= 450 THEN 'neutral' ELSE 'watch' END`);

  // Leg 1: the processor refunds within 0-2 days, the bank settles 1-3 days after, the ledger books both.
  await c.run(`CREATE SEQUENCE txn_seq START 1; CREATE SEQUENCE bank_seq START 1; CREATE SEQUENCE ledger_seq START 1; CREATE SEQUENCE scan_seq START 1`);
  await c.run(`CREATE TABLE proc (txn_id VARCHAR, order_id BIGINT, kind VARCHAR, leg INT, cents INT, day DATE, memo VARCHAR)`);
  await c.run(`CREATE TABLE bank (bank_id VARCHAR, txn_id VARCHAR, cents INT, day DATE)`);
  await c.run(`CREATE TABLE ledger (entry_id BIGINT, order_id BIGINT, decision_id VARCHAR, kind VARCHAR, leg INT, cents INT, day DATE, period VARCHAR, memo VARCHAR)`);
  await c.run(`CREATE TABLE wms (scan_id BIGINT, order_id BIGINT, day DATE, condition VARCHAR, qty INT)`);
  await c.run(`INSERT INTO proc SELECT 'rf_' || nextval('txn_seq'), order_id, 'refund', 1, leg1_cents, day + (FLOOR(${u('order_id', 20)} * 3))::INT, 'Vouch refund leg 1' FROM decisions WHERE leg1_cents > 0`);
  // Leg 2: 88% of returns come back intact 2-20 days after the decision; the rest lapse.
  await c.run(`INSERT INTO wms SELECT nextval('scan_seq'), d.order_id, d.day + (2 + FLOOR(${u('d.order_id', 21)} * 18))::INT, 'intact', d.authorized_qty FROM decisions d WHERE d.leg2_cents > 0 AND ${u('d.order_id', 22)} < 0.88`);
  await c.run(`INSERT INTO proc SELECT 'rf_' || nextval('txn_seq'), w.order_id, 'refund', 2, d.leg2_cents, w.day + (FLOOR(${u('w.order_id', 23)} * 2))::INT, 'Vouch refund leg 2' FROM wms w JOIN decisions d USING (order_id)`);
  await c.run(`INSERT INTO bank SELECT 'bk_' || nextval('bank_seq'), txn_id, cents, day + (1 + FLOOR(${u('hash(txn_id)', 24)} * 3))::INT FROM proc`);
  const ledgerFor = (kind: string, leg: number, amount: string, day: string, extra = '') =>
    `INSERT INTO ledger SELECT nextval('ledger_seq'), d.order_id, d.decision_id, '${kind}', ${leg}, ${amount}, ${day}, strftime(${day}, '%Y-%m'), '${kind}' FROM decisions d ${extra}`;
  await c.run(ledgerFor('leg1_authorized', 1, 'd.leg1_cents', 'd.day', 'WHERE d.leg1_cents > 0'));
  await c.run(`INSERT INTO ledger SELECT nextval('ledger_seq'), p.order_id, 'D-' || p.order_id, 'leg1_settled', 1, p.cents, p.day, strftime(p.day, '%Y-%m'), 'leg1_settled' FROM proc p WHERE p.leg = 1`);
  await c.run(`INSERT INTO ledger SELECT nextval('ledger_seq'), w.order_id, 'D-' || w.order_id, 'leg2_authorized', 2, d.leg2_cents, w.day, strftime(w.day, '%Y-%m'), 'leg2_authorized' FROM wms w JOIN decisions d USING (order_id)`);
  await c.run(`INSERT INTO ledger SELECT nextval('ledger_seq'), p.order_id, 'D-' || p.order_id, 'leg2_settled', 2, p.cents, p.day, strftime(p.day, '%Y-%m'), 'leg2_settled' FROM proc p WHERE p.leg = 2`);

  // ---------------------------------------------------------------- plants and decoys
  // Each decision falls in one of 40 slots: slots 0-9 hold class 1-10 plants, 10-19 their decoys.
  await c.run(`CREATE TABLE grader_truth (exception_id VARCHAR, cls INT, decoy BOOLEAN, split VARCHAR, order_id BIGINT, amount_cents INT, period VARCHAR)`);
  const pool = (slot: number, n: number, where: string) => `SELECT d.order_id, d.decision_id, d.leg1_cents, d.leg2_cents, d.day, d.amount_cents FROM decisions d WHERE (hash(${S}, d.order_id, 99) % 40) = ${slot} AND ${where} ORDER BY hash(${S}, d.order_id, 98) LIMIT ${n}`;
  const truth = async (cls: number, decoy: boolean, sel: string, amount: string) => {
    await c.run(`INSERT INTO grader_truth SELECT 'C${cls}${decoy ? 'D' : 'P'}-' || x.order_id, ${cls}, ${decoy}, CASE WHEN (hash(${S}, x.order_id, 97) % 10) < 7 THEN 'dev' ELSE 'holdout' END, x.order_id, ${amount}, strftime(x.day, '%Y-%m') FROM (${sel}) x`);
  };
  const has = (leg: number) => `EXISTS (SELECT 1 FROM proc p WHERE p.order_id = d.order_id AND p.leg = ${leg})`;
  for (const k of CLASSES) {
    const P = (n: number, where: string) => pool(k.id - 1, n, where);
    const D = (n: number, where: string) => pool(k.id + 9, n, where);
    switch (k.id) {
      case 1: // a support agent also refunded in the processor dashboard; the ledger never heard of it
        await truth(1, false, P(k.planted, has(1)), 'x.leg1_cents');
        await c.run(`INSERT INTO proc SELECT 'rf_' || nextval('txn_seq'), x.order_id, 'refund_manual', 1, x.leg1_cents, x.day + 1, 'Manual refund by support' FROM (${P(k.planted, has(1))}) x`);
        await truth(1, true, D(k.decoys, has(1)), '0');
        // decoy: two items on one order, each refunded and each booked
        await c.run(`UPDATE proc SET cents = cents // 2, memo = 'item 1 of 2' WHERE leg = 1 AND order_id IN (SELECT order_id FROM (${D(k.decoys, has(1))}))`);
        await c.run(`INSERT INTO proc SELECT 'rf_' || nextval('txn_seq'), p.order_id, 'refund', 1, p.cents, p.day, 'item 2 of 2' FROM proc p WHERE p.memo = 'item 1 of 2'`);
        await c.run(`UPDATE ledger SET cents = cents // 2, memo = 'item 1 of 2' WHERE kind = 'leg1_settled' AND order_id IN (SELECT order_id FROM (${D(k.decoys, has(1))}))`);
        await c.run(`INSERT INTO ledger SELECT nextval('ledger_seq'), l.order_id, l.decision_id, 'leg1_settled', 1, l.cents, l.day, l.period, 'item 2 of 2' FROM ledger l WHERE l.memo = 'item 1 of 2'`);
        break;
      case 2: // the processor refund failed: no processor row, no bank row; the ledger still says settled
        await truth(2, false, P(k.planted, has(1)), 'x.leg1_cents');
        await c.run(`DELETE FROM bank WHERE txn_id IN (SELECT txn_id FROM proc WHERE leg = 1 AND order_id IN (SELECT order_id FROM (${P(k.planted, has(1))})))`);
        await c.run(`DELETE FROM proc WHERE leg = 1 AND order_id IN (SELECT order_id FROM (${P(k.planted, has(1))}))`);
        await truth(2, true, D(k.decoys, has(1)), '0');
        await c.run(`UPDATE proc SET day = day + 7, memo = 'slow settlement' WHERE leg = 1 AND order_id IN (SELECT order_id FROM (${D(k.decoys, has(1))}))`);
        await c.run(`UPDATE bank SET day = day + 7 WHERE txn_id IN (SELECT txn_id FROM proc WHERE memo = 'slow settlement')`);
        break;
      case 3: // the processor paid; nobody booked it
        await truth(3, false, P(k.planted, has(1)), 'x.leg1_cents');
        await c.run(`DELETE FROM ledger WHERE kind IN ('leg1_settled') AND order_id IN (SELECT order_id FROM (${P(k.planted, has(1))}))`);
        await truth(3, true, D(k.decoys, has(1)), '0');
        await c.run(`UPDATE ledger SET day = (date_trunc('month', day) + INTERVAL 1 MONTH)::DATE, period = strftime((date_trunc('month', day) + INTERVAL 1 MONTH)::DATE, '%Y-%m'), memo = 'booked in next period on purpose (cut-off)' WHERE kind = 'leg1_settled' AND order_id IN (SELECT order_id FROM (${D(k.decoys, has(1))}))`);
        break;
      case 4: // the customer also disputed the charge after being refunded
        await truth(4, false, P(k.planted, has(1)), 'x.amount_cents');
        await c.run(`INSERT INTO proc SELECT 'dp_' || nextval('txn_seq'), x.order_id, 'chargeback', 0, x.amount_cents, x.day + 15, 'Dispute lost' FROM (${P(k.planted, has(1))}) x`);
        await truth(4, true, D(k.decoys, has(1)), '0');
        // decoy: a dispute on a different order of the same customer, one that was never refunded
        await c.run(`INSERT INTO proc SELECT 'dp_' || nextval('txn_seq'), o2.order_id, 'chargeback', 0, o2.price_cents, o2.day + 20, 'Dispute on another order'
          FROM (${D(k.decoys, has(1))}) x JOIN orders o ON o.order_id = x.order_id
          JOIN LATERAL (SELECT o2.order_id, o2.price_cents, o2.day FROM orders o2 WHERE o2.customer_id = o.customer_id AND o2.order_id <> o.order_id AND o2.order_id NOT IN (SELECT order_id FROM decisions) ORDER BY o2.order_id LIMIT 1) o2 ON TRUE`);
        break;
      case 5: { // leg 2 paid but the warehouse has no scan
        const w = `${has(2)}`;
        await truth(5, false, P(k.planted, w), 'x.leg2_cents');
        await c.run(`DELETE FROM wms WHERE order_id IN (SELECT order_id FROM (${P(k.planted, w)}))`);
        await truth(5, true, D(k.decoys, w), '0');
        await c.run(`UPDATE wms SET day = day + 5, condition = 'intact' WHERE order_id IN (SELECT order_id FROM (${D(k.decoys, w)}))`);
        break;
      }
      case 6:
        await truth(6, false, P(k.planted, has(2)), 'x.leg2_cents');
        await c.run(`UPDATE wms SET condition = CASE WHEN order_id % 2 = 0 THEN 'damaged' ELSE 'wrong_item' END WHERE order_id IN (SELECT order_id FROM (${P(k.planted, has(2))}))`);
        await truth(6, true, D(k.decoys, has(2)), '0');
        await c.run(`UPDATE wms SET condition = 'packaging_wear' WHERE order_id IN (SELECT order_id FROM (${D(k.decoys, has(2))}))`);
        break;
      case 7: // leg 2 booked into the month before the scan
        await truth(7, false, P(k.planted, has(2)), 'x.leg2_cents');
        await c.run(`UPDATE ledger SET day = (date_trunc('month', day) - INTERVAL 1 DAY)::DATE, period = strftime((date_trunc('month', day) - INTERVAL 1 DAY)::DATE, '%Y-%m'), memo = 'leg2 backdated' WHERE kind = 'leg2_authorized' AND order_id IN (SELECT order_id FROM (${P(k.planted, has(2))}))`);
        await truth(7, true, D(k.decoys, has(2)), '0');
        break;
      case 8: // bank and processor differ by a few cents
        await truth(8, false, P(k.planted, has(1)), '0');
        await c.run(`UPDATE bank SET cents = cents + (6 + (hash(${S}, bank_id, 8) % 55))::INT * CASE WHEN hash(${S}, bank_id, 9) % 2 = 0 THEN 1 ELSE -1 END WHERE txn_id IN (SELECT txn_id FROM proc WHERE leg = 1 AND order_id IN (SELECT order_id FROM (${P(k.planted, has(1))})))`);
        await c.run(`UPDATE grader_truth SET amount_cents = (SELECT ABS(SUM(b.cents - p.cents)) FROM bank b JOIN proc p USING (txn_id) WHERE p.order_id = grader_truth.order_id) WHERE cls = 8 AND NOT decoy`);
        await truth(8, true, D(k.decoys, has(1)), '0');
        await c.run(`UPDATE bank SET cents = cents + (1 + (hash(${S}, bank_id, 8) % 5))::INT WHERE txn_id IN (SELECT txn_id FROM proc WHERE leg = 1 AND order_id IN (SELECT order_id FROM (${D(k.decoys, has(1))})))`);
        break;
      case 9: // the 2.9% fee was added into the refund line in the ledger
        await truth(9, false, P(k.planted, has(1)), '(SELECT fee_cents FROM orders o WHERE o.order_id = x.order_id)');
        await c.run(`UPDATE ledger SET cents = cents + (SELECT fee_cents FROM orders o WHERE o.order_id = ledger.order_id), memo = 'refund incl. fee' WHERE kind = 'leg1_settled' AND order_id IN (SELECT order_id FROM (${P(k.planted, has(1))}))`);
        await truth(9, true, D(k.decoys, has(1)), '0');
        await c.run(`INSERT INTO ledger SELECT nextval('ledger_seq'), x.order_id, x.decision_id, 'processor_fee', 0, (SELECT fee_cents FROM orders o WHERE o.order_id = x.order_id), x.day, strftime(x.day, '%Y-%m'), 'fee not returned on refund (expensed)' FROM (${D(k.decoys, has(1))}) x`);
        break;
      case 10: { // a 3-piece bundle: one piece back, full second leg paid
        const w = `${has(2)} AND d.authorized_qty = 3`;
        await truth(10, false, P(k.planted, w), '(x.leg2_cents * 2) // 3');
        await c.run(`UPDATE wms SET qty = 1 WHERE order_id IN (SELECT order_id FROM (${P(k.planted, w)}))`);
        await truth(10, true, D(k.decoys, w), '0');
        break;
      }
    }
  }
  const counts: Record<string, number> = {};
  for (const tname of ['orders', 'decisions', 'proc', 'bank', 'wms', 'ledger', 'grader_truth']) counts[tname] = (await rows<{ n: number }>(c, `SELECT COUNT(*) n FROM ${tname}`))[0]!.n;
  c.closeSync();
  return { ms: Date.now() - t0, counts };
}
