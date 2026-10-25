# AGENTS.md: Vouch World (Cal Hacks 13.0, deadline Sun 9:00 AM PT)

The full build spec is "Vouch World: Agent Build Spec" (Oct 24). This file is the short version an agent needs every session. It replaces the earlier "Vouch Refunds" brief: Threadline, the refund ladder, CRS and Nessie are gone; Factory Droid and `/lab` are in.

## One sentence
Vouch is trust infrastructure for shopping when consumers and AI agents buy on people's behalf: CREAO agents investigate refunds, a SpacetimeDB economy of 10,000 simulated shoppers shows the effect live on a globe, and Factory Droid improves the fraud detectors inside the running product.

## The one story (if a feature is not in it, it is not P0)
An agent buys something → asks for a refund with a video → CREAO agents analyse the evidence and the history → the business decides → the agent's credit changes → the event shows up live on the globe.

## Sponsors and what makes each load-bearing
- **CREAO**: three saved agents (Evidence Analyst, Refund Investigator, Pattern Analyst) are the only source of findings, recommendations and fraud confirmations. Kill switch `control.creao_enabled`: off means "Investigator offline", the business can only request more evidence, and no pattern can be confirmed. The Desk Lead (`worker/src/orchestrator.ts`) is code, not an agent.
- **SpacetimeDB**: the only database. The simulation runs inside the module as a scheduled reducer (`module/src/economy.ts` → `module/src/sim.ts`). Browsers subscribe directly. Segregation of duties and revocation live in reducers.
- **Factory**: the Detector Lab. Droid writes candidate detectors in `detectors/candidates/<job>/`, runs two fenced commands, and every plan/tool call/diff/score is a `lab_event` row shown on `/lab`. A person promotes.
- Hyphenate stays eligible (refund analyst seat, controller above $500, journal entries) but nothing depends on it.

## Stack (do not add services without asking)
- `module/` SpacetimeDB 2.13 TypeScript module. `sim.ts`, `world.ts`, `score.ts`, `text.ts`, `rng.ts`, `simdb.ts`, `memdb.ts` are pure (no `spacetimedb` import) and shared with web, worker and `detectors/eval.ts`.
- `worker/` Node 22: CREAO adapter and orchestrator, ffmpeg frames, detectors, Droid Lab, credential signing, ledger poster. Two identities: `worker` and `poster`.
- `web/` Next.js 16 App Router + Tailwind 4 + motion + react-globe.gl + Recharts. Routes: `/ /world /shop /claim/[id] /business /lab /system`.
- `detectors/` live detectors, `candidates/` (the only folder Droid may write), `eval.ts` (fixed evaluator).
- Not in the stack: Convex, Fetch, Coinbase/x402, Bright Data, CRS, Nessie, any second database.

## Hard rules
- Honest labels: every number carries a badge: **Live** (from SpacetimeDB rows now), **Simulated** (from the agent simulation), **Fixture** (recorded test data), or **Replay of real run**. Never show a hard-coded number as Live.
- No real people. Show "Simulated agents. Vouch does not track real locations." on Vouch World.
- Keys stay server-side: no `capi_`/`cr_sk_` key, `FACTORY_API_KEY` or issuer private key in `web/` or any client bundle. `npm run check:rules` greps for them.
- Never deny on thin evidence: unsure → more evidence or a person, never an automatic decline. The fast policy engine never declines.
- Shared region or shared business is never evidence of fraud. Detectors use behaviour only; a test shuffles regions and checks `coordinated` does not change.
- Credits are finite: tests use fixtures (`CREAO_MODE=fixture`), nothing starts itself in a loop, lab jobs are capped at 6 per simulation run, pattern reviews at 12.
- Never stop for a missing key: build and test in no-keys mode, log `UNVERIFIED-LIVE: <service>: <command>` in PROGRESS.md and docs/LIVE_CHECKLIST.md.
- Photo/video checks say "internally consistent, not proof of authenticity". The word "scam" does not appear in the UI.
- Never invent run links, agent IDs, benchmark numbers or detector scores; leave `<fill in>`.

## Repo map and commands
```
module/src  schema.ts (tables) economy.ts (init, seedWorld, tick) control.ts consumer.ts claims.ts desk.ts patterns.ts credentials.ts lab.ts views.ts truth.ts
            sim.ts (the engine) world.ts score.ts text.ts rng.ts simdb.ts memdb.ts
worker/src  server.ts stdb.ts env.ts creao.ts orchestrator.ts video.ts detectors.ts lab.ts credentials.ts poster.ts showcase.ts
web/        app/ routes, components/, lib/stdb (connection + hooks), module_bindings/ (generated)
detectors/  live/ candidates/ eval.ts test.ts LAB.md
scripts/    env-check.ts hello-stdb.ts hello-creao.ts hello-droid.ts demo-reset.ts make-agent.ts bench.ts export-history.ts check-rules.ts
```
```
npm install      npm run check        (typecheck + module/worker tests + rule checks)
npm run stdb:start   npm run stdb:publish   npm run stdb:generate   npm run worker   npm run dev
npx tsx scripts/env-check.ts    npx tsx detectors/eval.ts --live --seed 7 --agents 3000
```
SpacetimeDB facts learned the hard way: the module entry file may export only reducers/views/procedures (a helper export breaks publishing); a view's row type name must not collide with a table's type name; SQL uses snake_case columns.

## Loops (spec section 13)
Loop 1 builds gate by gate (G0..G6, tests T0.1..T6.4 in PROGRESS.md). Loop 2 only tests (writes `qa/` and `QA_REPORT.md`). Loop 3 fixes with a regression test per issue. Tick a test only with evidence. Commit after each step with a one-line message.

## Style
TypeScript strict. Small files. No clever abstractions. Comment why, not what.

Note: `web/AGENTS.md` is written by Next.js. This Next.js has breaking changes from older versions: read `node_modules/next/dist/docs/` before writing web code.


<claude-mem-context>
# Memory Context

# [vouch] recent context, 2026-10-24 7:57pm PDT

No previous sessions found.
</claude-mem-context>
