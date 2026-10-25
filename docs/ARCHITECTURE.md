# Architecture

```
 phone /claim ──upload──► worker (Node 22, :8787) ──reducers──► SpacetimeDB module (the only database)
 browser pages ◄──────────── subscriptions ─────────────────────  tables, reducers, scheduled tick
                              worker ◄── subscriptions ──────────  (sim runs inside the module)
                              worker ──► CREAO (3 saved agents)    worker ──► Droid SDK (lab, laptop)
```

- **The SpacetimeDB module (`module/`)** holds every row. It runs the simulation as a scheduled reducer, and its reducers enforce who may do what.
- **The browser** reads only through subscriptions and writes only through reducers.
- **The worker** does the slow or secret work. It calls CREAO, runs the video pipeline, the detectors, the ledger poster, the credential issuer and verifier, the Droid lab and the showcase loop, then writes results back through worker-only reducers. Keys (`capi_`/`cr_sk_`, `FACTORY_API_KEY`, issuer private keys) never leave it.
- **Agents never touch the database.** They return one JSON object; the worker validates it and calls a reducer.

## Repo map

| Path | What |
| --- | --- |
| `module/src/schema.ts` | All 31 tables. Public tables hold no ground truth; `agent_truth`, `seat_code`, `shopper_link`, `refund_intent` are private. |
| `module/src/sim.ts` | The engine: seeding, one step per agent, day end (deliveries, fast decisions, investigations, ring bursts), credit. Pure over `SimDb` (`simdb.ts`), so the same code runs in the module, in tests (`memdb.ts`) and in the evaluator. |
| `module/src/{world,text,score,rng}.ts` | Regions, businesses and catalog; claim text; the credit score and bands; the deterministic RNG. Pure, shared with web and worker as `@vouch/module/*`. |
| `module/src/economy.ts` | `init`, `seedWorld`, `tick` (only the database itself may call `tick`). |
| `module/src/consumer.ts` | The real shopper: `joinAsShopper`, `buy`, `fastForward`, `requestRefund`. |
| `module/src/claims.ts`, `desk.ts`, `patterns.ts` | Claim lifecycle, the decision desk (segregation of duties), fraud patterns. |
| `module/src/credentials.ts`, `lab.ts`, `control.ts` | Credential registry and verification requests, the Droid lab queue, seats, controls, the sim speed, pings and bench results. |
| `worker/src/server.ts` | Fastify routes (`/health`, `/upload/:claimId`, `/media/...` signed, `/creao/webhook`, `/showcase/run`) and service start-up. |
| `worker/src/orchestrator.ts`, `creao.ts`, `fixtures.ts` | The Desk Lead: claim flow (Evidence Analyst → Investigator → `propose`), the pattern flow (Pattern Analyst → `confirmPattern`), the CREAO adapter, fixture answers. |
| `worker/src/video.ts` | ffprobe, frame selection, dHash, reuse search, blank frames, signed media URLs, `attachVideo`. |
| `worker/src/detectors.ts`, `mirror.ts`, `history.ts` | Runs `detectors/live/*` every 5 simulated days on an indexed mirror of the client cache. |
| `worker/src/poster.ts`, `credentials.ts`, `lab.ts`, `showcase.ts` | Ledger poster (second identity), Ed25519 issuer and verifier, the Droid lab runner and its permission fence, the A-00421 showcase loop. |
| `detectors/` | `live/` detectors, `candidates/` (Droid's only writable folder), `test.ts`, `eval.ts` (fresh worlds, ground truth), `LAB.md`. |
| `web/app/*` | Pages: `/`, `/world`, `/shop`, `/claim/[id]`, `/business`, `/system`. `/lab` redirects to `/world`. `web/lib/routes.ts` is the nav. |
| `web/lib/stdb/*` | Provider, hooks (`useConn`, `useTableVersion`, `useRowsThrottled`, `useCall`), latency. |
| `web/components/*` | One folder per page, plus `ui/` (badges, numbers, nav) and `background/` (Constructa's HeroCanvas, recoloured). |
| `scripts/` | Publish, generate, demo reset, env check, hello scripts, bench, claim flow, rule and badge checks. |
| `e2e/`, `qa/` | Playwright smoke tests; the QA loop's checklist, personas and videos. |

## Roles (`role` table, enforced by `requireRole`)

| Role | Who | May |
| --- | --- | --- |
| `worker` | The worker's identity (first `bootstrapWorker`) | Write claims' evidence, runs, proposals, patterns, lab events, verifications |
| `poster` | A second worker identity | Post a balanced journal entry for a decided refund, and nothing else |
| `business` | A person with `DEMO_BUSINESS_CODE`, bound to one business (B-002 or B-019) | Decide that business's refunds (not their own proposals), flip the kill switch, open an investigation, issue/revoke its credentials |
| `controller` | A person with `DEMO_CONTROLLER_CODE` | Decide above $500, all controls, promote or reject lab candidates, reseed |
| shopper | Any browser identity after `joinAsShopper` (linked through the private `shopper_link`; `my_agent` view) | Buy, fast-forward, request a refund for their own agent |

The proposer cannot decide, the decider cannot post, and an entry that does not balance is refused (`module/src/desk.ts`).

## Where things go

| I want to... | Do this |
| --- | --- |
| Add a table | Define it in `module/src/schema.ts` and add it to `schema({...})`. Keep ground truth and codes private. Then `npm run stdb:publish && npm run stdb:generate`. |
| Add a reducer | Put it in its area's file, gate it with `requireRole`, then add its name to the explicit exports in `module/src/index.ts` (exporting anything else breaks publishing). |
| Change the simulation | Edit `module/src/sim.ts`; keep it deterministic (only `Rng`, never `Math.random`). `npm test -w module` checks determinism, credit causes and region totals. |
| Add a page | `web/app/<name>/page.tsx` plus a line in `web/lib/routes.ts`. Badge every number (`<Badge kind="live"/>` or `<Stat>`). `npx tsx scripts/check-badges.ts` and `npm run check:rules` check this. |
| Add a detector | `detectors/live/<id>.ts` exporting `detector: Detector` (`{ id, version, run(history) }`, types in `detectors/types.ts`). Behaviour features only. From `detectors/`, run `npx tsx test.ts` and `npx tsx eval.ts --live`. |
| Add an agent seat | Add it to `Seat` and `AGENT_NAMES` in `worker/src/creao.ts` and `env.ts`, add a fixture in `worker/fixtures/`, a flow in `orchestrator.ts`, a card in `web/components/business/org-chart.tsx`, and a row in `docs/CREAO.md`. |

## SpacetimeDB lessons (2.13.0)

- The entry file may export only reducers, views and procedures. Row type names must be unique across tables and views.
- The client cache's `find()` scanned every row in our test, so the worker keeps its own Maps (`worker/src/mirror.ts`).
- The browser subscribes only to what a screen needs. `/world` re-renders on a throttle (agents every 1.5 s, the feed every 400 ms).
