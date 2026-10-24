# AGENTS.md: Vouch Refunds (Cal Hacks 13.0, deadline Sun 9:00 AM PT)

## One sentence
Vouch Refunds lets a retailer's refunds team refund good customers faster and lose less to bad claims: it vouches for the customer (a stored Vouch Record, tier 0..3), an AI desk checks the contested claims, and the same record is the foundation for shopping agents. Every decision shows its evidence.

## Audience and framing
The user is the refunds team (support lead, risk or fraud analyst, finance person) at an online fashion retailer. A refund paid before the return arrives is a short unsecured advance. Vouch is the credit analyst for it: a limit per tier, review afterwards, an incident cuts the limit.

## Four layers, one engine
1. Vouch the customer: Vouch Record (tier 0..3, reasons, expiry), built by the Credit Analyst agent from payment history, verified identity and past claims.
2. Refund more, sooner: refund ladder. Tier 0 -> Lane C. Tier 1 -> Lane B. Tier 2 -> Lane A under $200, over the cap falls to B. Tier 3 -> Lane A under $1,000, over the cap falls to B. Unable to verify -> C (never deny). Duplicate photo or incident -> D with a person. A merchant risk dial moves the caps.
3. Check the claim: the Refund Desk agent reads the claim, photos and policy; the refund risk model scores it; photo hashes catch reuse. It proposes, a person decides.
4. Foundations for agent shoppers: agents register with a principal and a mandate; the Agent-Order Underwriter returns allow | escrow | step_up | block.

Engine: `handshake(buyerTier, sellerTier, item)` in `module/src/handshake.ts`; `decide(tier, evidence, flags, claim, policy)` in `module/src/policy.ts`. In this build the merchant is fixed at seller tier 2.

Major sponsors: Hyphenate (the seats: refund and dispute analyst, credit analyst, cash applier and reconciler, revenue and close accountant) and CREAO (four saved agents are the product). Supporting, used but not chased: SpacetimeDB, CRS, Nessie. Roadmap only, do not build: Brand Vouch, High-Ticket Vouch, seller tiers, Payout Desk, Brand Underwriter.

Vouch Desk: four saved CREAO agents (Refund Desk, Credit Analyst, Agent-Order Underwriter, Reconciler) propose; the worker's Desk Lead (code, not an agent) routes cases; the database enforces segregation of duties in `module/src/desk.ts` (whoever proposes cannot decide, whoever decides cannot post); books export to Beancount.

## Stack (do not add services without asking)
- SpacetimeDB 2.13 module in `module/` is the ONLY database and the live-state bus. Web and worker subscribe to it.
- `worker/` (Node 22) does slow or secret work: CREAO agent calls (`worker/src/creao.ts`), the risk model bridge, CRS, Nessie.
- `ml/`: rules tree + IsolationForest + LightGBM + logistic stacker. Train on Threadline seed 11, test on seed 23.
- `world/`: Threadline, a simulated online fashion retailer with planted errors and an answer key. Regenerate with `python3 world/generate.py`.
- `web/`: Next.js + Tailwind. Pages: / /atlas /console /shopper /agents /merchant. One accent color. No /sellers and no /lab.
- Not in the stack: Fetch, Coinbase/x402/Base, Factory Droid, Bright Data, Anthropic API. Do not add them.

## Hard rules
- Honesty: every number in the UI carries a Live / Seeded / Simulated badge. No unlabeled fake data. Never claim a sponsor integration the code does not call.
- Underwrite slowly, spend trust instantly: an agent run takes minutes and is never inside an instant path. The instant lane reads a stored, signed, expiring Vouch Record under a cap; the Refund Desk reviews the payment afterwards, and a bad review posts an incident that drops the tier.
- Kill switch: when `creao_enabled` is off, or no agent run has completed inside the expiry window, new cases drop to lane C with the reason "underwriter offline". Fail closed. The demo line is: remove the agent and this product dies.
- Agents propose; only the poster writes. No agent moves money or posts to the ledger. A proposal that does not balance is refused. The controller approves above $500.
- Never deny on a thin history: unknown or unverifiable -> lane C (hold and verify), reason code UNABLE_TO_VERIFY.
- PII stays in private SpacetimeDB tables.
- Test identities and sandbox keys only. Secrets only in .env. `capi_` keys never reach web/. Never commit .env.
- Photo checks say "internally consistent, not authenticated". The word "scam" does not appear in the UI.
- The refund risk model is unmeasured until we run it on seed 23. Do not quote its numbers before then. The detector numbers are on a simulated company and say so.

`npm run check:rules` enforces the mechanical ones (no "scam" in the UI, no secrets in web/, every nav link has a page, dropped surfaces stay dropped).

## Repo map and commands
```
web/      Next.js app. app/ routes, components/, lib/routes.ts (nav source of truth), lib/data/hooks.tsx (the live-data seam)
module/   SpacetimeDB module (schema.ts, desk.ts, claims.ts, vouch.ts, agents.ts, settings.ts, index.ts)
          plus pure code shared with web and worker: types.ts, handshake.ts, policy.ts (with tests)
worker/   Desk Lead: creao.ts, route.ts, breaker.ts, risk.ts, bridge.ts, hub.ts, index.ts
world/ ml/ seed/ scripts/ docs/   see each README
```
```
npm install        npm run dev        npm run check        (typecheck + lint + tests + rule checks)
npm run stdb:publish   npm run stdb:generate   npm run seed   npm run demo:reset   npm run hello:{crs,creao,nessie}
```
See `docs/ARCHITECTURE.md` for how to add a page, table, reducer or agent seat without touching unrelated code.

## Build order (stop at each gate and tell the humans)
0. Scaffold repo, install deps, commit. Write scripts/hello-*.ts for CRS, CREAO, Nessie; each prints one real response. (Scaffold DONE; hello scripts: CREAO and Nessie written, CRS needs the hackpack; none run yet.)
1. GATE (hour 3): publish module, show one live row in two browser tabs and in the worker. If it fails, stop and report; fallback is Convex. (NOT RUN: the module type-checks but has never been published.)
2. Seed: scripts/seed.ts loads personas, claims and photos (labelled Seeded). Run world/generate.py for Threadline.
3. Refund ladder hero path end to end: claim -> stored Vouch Record -> Policy Engine -> lane on /console and /atlas; a new subject goes to lane C while the Credit Analyst builds its record.
4. Desk: module/src/desk.ts and handshake.ts published; worker calling the four saved agents with webhooks and the kill-switch row; world/detect.py and books.py scores on /console.
5. Refund risk model: ml/train.py, ml/eval.py, worker/src/risk.ts; risk dial on /merchant.
6. Books, Proof panel, /agents page with mandate checks. Demo script runs end to end by Saturday 10 PM.
7. README (four agent IDs and run share links), AWARDS.md, AGENT_BRIEF.md, demo reset script, 3-minute demo rehearsal twice.

Cut order if late: Oracle stretch, curve animation, risk model (use the detector score), Reconciler cutoff cases. Never cut: the refund ladder, four CREAO agents with run links, kill switch, Threadline books and Proof panel, the controller's no, the CRS call, the agent mandate check.

## Definition of done for each step
A command a stranger can run, a screen they can open, and one line in docs/REAL_VS_SIMULATED.md saying what is live.

## Style
TypeScript strict. Small files. No clever abstractions. Comment why, not what. Commit after each step with a one-line message.

Note: `web/AGENTS.md` is written by Next.js. This Next.js has breaking changes from older versions: read `web/node_modules/next/dist/docs/` (or `node_modules/next/dist/docs/` from the root) before writing web code.
