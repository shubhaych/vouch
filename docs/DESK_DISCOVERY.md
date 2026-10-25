# Refund Finance Desk: discovery (written before any Desk code)

The master prompt describes a repo shape that differs from this one. This file records what is really here, where the prompt does not match, and what was chosen. Anything not listed here follows the prompt.

## (a) Real names

| Prompt says | In this repo |
| --- | --- |
| `apps/web` (Next.js) | `web/` (Next.js 16 App Router). Routes today: `/ /world /shop /claim/[id] /business /lab /system` |
| `apps/mobile` (Expo) | none. The phone uses `web/app/claim/[id]` |
| `packages/module` (SpacetimeDB 2.x) | `module/` (SpacetimeDB 2.13 TypeScript). One `schema()` in `module/src/schema.ts`; entry `module/src/index.ts` may export only reducers |
| `packages/shared` | none. Pure code shared by web, worker and module lives in `module/src/*.ts` without a `spacetimedb` import (as `sim.ts`, `world.ts` do). Desk shared code: `module/src/finance/` |
| `packages/shared/policy.json`, `sim.json` | `module/src/finance/policy.ts` and `module/src/finance/sim-config.ts` (typed constants; the module bundle cannot read JSON at runtime). The Proof screen prints them |
| `packages/shared/seed/companies.seed.json` | `module/seed/companies.seed.json` (copied exactly, outside `src/` so it is never bundled). `scripts/gen-companies.ts` writes `module/src/finance/companies.ts` **without `inspiredBy`** |
| `services/worker` | `worker/` (Node, `npx tsx worker/src/server.ts`). Desk code: `worker/src/finance/` |
| decision record | `refund` (status, amount), `decision` (proposal and the person's final action), `recommendation` (tier T1–T5, refundNow/refundOnReturn, return required), `report` (full JSON incl. `factoryAssessment`, evidence artifact ids), `claim_score` (P(legit), formula version) |
| business report page | `web/components/business/report-panel.tsx` (`ReportPanel`), inside `web/app/business` |
| CREAO client | `worker/src/creao.ts` (`startRun` POST /v1/runs, `waitForRun` polls GET /v1/runs/{id}, `resolveAgents` GET /v1/agents; fixture mode via `CREAO_MODE=fixture`) |
| shopper score change | `applyCredit` in `module/src/sim.ts`, written as `credit_event` rows when a refund settles |
| existing journal | `journal_entry` / `journal_line` + `decide` / `post` reducers in `module/src/desk.ts` (proposer cannot decide, decider cannot post, entries balance). These stay untouched; the Desk has its own `finance_` ledger |

## (b) How score, band and tier reach code

- Shopper score and band: `agent.score` (u16) and `agent.band` (string), public table, 10,000 simulated agents plus live shoppers (ids from 900,000).
- Tier: `recommendation.tier` (T1–T5), with `refundNow` and `refundOnReturn` in cents and `returnRequired`. The two legs of the prompt are exactly `refundNow` (leg 1) and `refundOnReturn` (leg 2).
- Formula version: `claim_score.formulaVersion` and `report.formulaVersion` (`FORMULA_VERSION` in `module/src/review-score.ts`).
- Evidence ids: `artifact` rows of the job, cited by `finding.artifactIds`.

## (c) Where the prompt does not match, and the choice made

1. **The 100 retailers do not exist yet.** The main path has 60 fixed businesses in 6 categories (`world.ts`, B-001..B-060; the demo uses B-019 and B-002). Replacing them would change the main path, which the prompt forbids. **Choice:** the 100 companies from the seed are the Desk's partner companies in their own `finance_company` / `finance_product` tables. The 60 main-path stores are unchanged. The live claim (whichever main-path store it was filed at) is booked into the featured company's book as order 1,000,001, as the prompt asks.
2. **The simulation is not idle.** The existing in-database sim already runs 10,000 agents, fraud rings, detectors, a Pattern Analyst and a Droid Lab for the 60-store world (`/world`, measured latency and `bench_result`). Rewriting it for 100 companies would touch the main path. **Choice:** a second scheduled reducer, `finance_tick`, runs the 100-company portfolio inside the same module: one tick is one simulated hour, every company gets orders, claims, flags, investigations and returns from its category rates, and the **shoppers are the existing 10,000 agents** (their real Vouch score and band from the `agent` table; their hidden kind from `agent_truth` decides who is fraudulent). Clients subscribe only to per-company aggregates. The existing `/world` stays the high-volume SpacetimeDB showcase; `/pulse` is not rebuilt (cut, see below).
3. **Volumes.** The prompt's targets (about 25,000 orders and 3,300 claims per sim-month) are kept as constants in `sim-config.ts`; orders are counted per company per hour, claims are rows (about 5 per sim-hour across all 100 companies), so per-claim rows, obligations and journal entries stay small enough for maincloud.
4. **Ledger scale.** The featured company's 1,000,000 orders live in DuckDB in the worker (`worker/data/brindle.duckdb`, git-ignored), as the prompt asks. Posting uses one rule table (`module/src/finance/posting.ts`) that the reducers apply in TypeScript and the worker applies in SQL, so the live claim and the bulk book are booked by the same rules. Controls (balance, append-only, locked periods, three identities, limits) are enforced in reducers for every entry that reaches SpacetimeDB, and by the same pure checks in the bulk path.
5. **Identities.** Roles today: `worker`, `poster`, `business`, `controller`. **Choice:** three new worker-side identities claim `accountant`, `reconciler` and `analyst` with a bootstrap reducer (the same pattern as `bootstrapPoster`). The requester is the existing `worker` identity (the Vouch decision engine). The controller is the existing human `controller` seat (seat code), which a judge can take.
6. **CREAO.** The existing client resolves seats from `env.ts`. Adding the five finance seats there would make the main path aware of the Desk. **Choice:** `worker/src/finance/creao.ts` is a separate client for the five finance agents with the env names the prompt gives (`CREAO_AGENT_IMPACT_ANALYST`, …) and mock / live / replay modes; it reuses only the HTTP shape of the existing one.
7. **The Refund Reviewer** in this repo reviews the video report and agrees or disagrees with the tier; it does not change the shopper score (code does, via `applyCredit`). The Case screen shows it as "the shopper-side judgment" next to the two company-books judgments.
8. **No `pnpm`.** Commands are `npm run …` (`npm run creao:check` instead of `pnpm creao:check`).
9. **Feature flag.** `NEXT_PUBLIC_DESK=1` shows the "Finance impact" button on the report and a "Finance Desk" link in the business header. With the flag off the business page renders exactly as before.

## Cut for now (prompt cut order), recorded in FINANCE_STATUS.md

Toolsmith, free-text scenarios (chips first), `/pulse` as a separate page (the existing `/world` is the SpacetimeDB showcase), the benchmark-against-another-database stretch, Beancount export, and Droid SDK items 7.6–7.11. The Droid exception investigator (7.1–7.5) comes after the thin slice.
