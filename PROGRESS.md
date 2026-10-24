# Vouch World progress
Loop: 1 Build done, Loop 2 next | Gate: G5/G6 | Sim day: live on /system | Last green e2e: 2026-10-24 12:46 UTC (`npx playwright test e2e/`, 4/4)

Environment for this session: local SpacetimeDB 2.13.0 standalone on `ws://localhost:3011` (installed in the cloud session, `spacetime start`), not Maincloud. "Live" below means against that running server. CREAO runs in fixture mode. Every live-only step is listed in `docs/LIVE_CHECKLIST.md`.

## Blocked (humans)
- BLOCKED: create the three CREAO agents in agent.creao.ai (docs/CREAO.md) and put an account key (`cr_sk_`) in `CREAO_API_KEY`. The session has one app-scoped `capi_` key and no app ids, so no agent can be called yet (`GET /v1/agents` answers 401).
- BLOCKED: record the real claim videos V01-V07, V15, V16 on a phone into `qa/videos/`.
- BLOCKED: `FACTORY_API_KEY` and the `droid` CLI exist only on the demo laptop.

## Gate G0 Foundations
- [x] T0.1 Monorepo with `module`, `web`, `worker`, `detectors`; `npm run typecheck` passes. (`npm run check` green 12:38; `npm run lint` 0 errors)
- [x] T0.2 `web/DESIGN.md` with Constructa's tokens, section order and background component; `e2e/constructa-ref.png` saved.
- [x] T0.3 Module publishes; `hello-stdb.ts` inserts a row and two browser tabs both show it live. (e2e "T0.3 a row inserted by one client shows up live in two other tabs" passed; `npx tsx scripts/hello-stdb.ts 50`: p50 2 ms, p95 4 ms)
  - UNVERIFIED-LIVE: SpacetimeDB Maincloud: `STDB_SERVER=maincloud STDB_DB=vouch-world npm run stdb:publish && STDB_URI=https://maincloud.spacetimedb.com STDB_DB=vouch-world npx tsx scripts/hello-stdb.ts 50`
- [x] T0.4 The scheduled tick fires: `sim_run.day` advances on its own. (`spacetime sql vouch "SELECT day, cursor FROM sim_run" -s dev3011`: day 120 → 149 in ~60 s; metrics.last_tick_micros 203424 at 5 ticks/s with 10,000 agents)
- [ ] T0.5 `hello-creao.ts` starts one run per saved agent and gets a result (human-run; response saved as a fixture). Code done; adapter tested on both API paths against a stand-in server (`worker/test/creao.test.ts`).
  - UNVERIFIED-LIVE: CREAO: `CREAO_MODE=live npx tsx scripts/hello-creao.ts --record`
- [ ] T0.6 `hello-droid.ts` streams one message from a Droid session on the laptop (human-run). Code done; type-checks against `@factory/droid-sdk` 0.10.0.
  - UNVERIFIED-LIVE: Factory: `npx tsx scripts/hello-droid.ts`

## Gate G1 The economy
- [x] T1.1 `seedWorld(seed=11, population=10000)` creates 10,000 agents, 60 businesses, 40 regions; seeding twice without force is refused. (module tests "creates 10,000 agents…", "T1.1 refuses to reseed without force")
- [x] T1.2 Same seed, same first 1,000 events (module test "same seed, same first 1,000 events; a different seed differs").
- [x] T1.3 Every score change has a `credit_event` with a cause (module test, 200 agents).
- [x] T1.4 `region_stat` totals equal the sums over `purchase` and `refund` (module test after 30 days).
- [x] T1.5 `/world` renders 10,000 agent points and businesses; arcs appear for new purchases within 1 second of the row. (e2e "T1.5/T1.6" passed after `demo-reset`; screenshot `e2e/shots/world-1440.png`)
  - UNVERIFIED-LIVE: 45 fps on the demo laptop (headless runs in software GL): Chrome DevTools → Rendering → Frame rendering stats on `/world`
- [x] T1.6 The live event monitor streams `event_feed`; clicking a line selects the agent. (same e2e)
- [x] T1.7 `/system` shows row counts, agent-steps per second, events per second and ping p50/p95, all badged Live. (e2e "T1.7" passed; `npx tsx scripts/check-badges.ts`: every page ok)

## Gate G2 One live claim, end to end
- [x] T2.1 `/shop`: a fresh visitor gets an agent, buys an item, fast-forwards, requests a refund; the QR opens `/claim/[id]`. (e2e "T2.1/T2.8" passed in the browser)
  - UNVERIFIED-LIVE: phone: scan the QR on `/shop` with a phone via the tunnel (`NEXT_PUBLIC_WORKER_URL`)
- [ ] T2.2 Upload rejects a wrong nonce, a stale claim, and a video under 4 seconds. (short and corrupt videos answer 422; wrong nonce 403 and stale 410 are in `worker/src/video.ts` but are checked in Loop 2)
- [x] T2.3 The worker extracts 8 to 10 frames including the first and last second, stores hashes, calls `attachVideo`. (`npx tsx scripts/claim-flow.ts`: "9 frames, 8.0 s 640x480")
- [x] T2.4 Frame reuse: uploading the same video for a second claim shows "Matches frames from claim ...". (claim-flow twice; `worker/test/video.test.ts` matches a re-encoded copy)
- [x] T2.5 The orchestrator runs Evidence Analyst then Investigator; `/business` shows both runs progressing, then findings with boxes and a recommendation with cited reasons. (fixture mode, labelled Fixture; worker log "C-14: Investigator recommends accept $249.00 (fixture)")
  - UNVERIFIED-LIVE: CREAO: `CREAO_MODE=live npm run worker` then `npx tsx scripts/claim-flow.ts qa/videos/G01-testsrc.mp4`
- [x] T2.6 Unparseable agent output fails closed (`unable_to_verify`, `more_evidence`). (worker test "app path: … unparseable output fails closed")
- [x] T2.7 Kill switch off: a new claim gets "Investigator offline" and no CREAO run starts. (module test "with no recommendation a person can only request more evidence"; orchestrator checks the switch before each run and before the proposal; end to end in Loop 2)
- [x] T2.8 Accept writes a decision, a balanced journal entry and +12 credit; the phone shows the decision and the score tween; the globe shows the arc and the credit event. (module test "T2.8 accept pays +12…"; e2e "T2.1/T2.8": credit 600 → 612)
- [x] T2.9 The proposer identity cannot call `decide`; a refund above $500 requires the controller. (module tests)

## Gate G3 Vouch World features
- [x] T3.1 Clicking an agent opens its panel with tiles, chips, credit progression and timeline. (e2e T1.5/T1.6 opens `agent-panel`)
- [ ] T3.2 Clicking a graph point opens the exact purchase or refund that caused it. (built: `CauseCard` in `agent-panel.tsx`; checked in Loop 2)
- [x] T3.3 The three detectors run every 5 simulated days and write patterns with `pattern_event` rows and `why` lines. (worker log "detectors on day 130: … 3 new patterns"; 284 patterns and 23,898 pattern_event rows by day 720)
- [x] T3.4 Shuffling regions does not change `coordinated` output (worker test; also `detectors/test.ts`).
- [x] T3.5 The evaluator prints precision, recall and honest-agents-flagged per detector on a fresh seed. (`npx tsx detectors/eval.ts --live --seed 23`: coordinated 100.0% precision, 100.0% ring recall, 0/2,469 honest flagged)
- [ ] T3.6 Replay: clicking a pattern fits the camera, dims the rest, and the scrubber plays purchases, deliveries, refunds and the detection moment in sync with the list. (built: `replay.tsx`; checked in Loop 2)
- [x] T3.7 The Pattern Analyst reviews a flagged pattern once; Confirmed applies −120 to each core agent; Dismissed applies nothing. (module test "confirm applies -120 to core agents only…"; fixture mode reviews at most 12 per run)
  - UNVERIFIED-LIVE: CREAO: the next new pattern with `CREAO_MODE=live` gets one Pattern Analyst run
- [ ] T3.8 Observatory: each of the seven metrics re-colours the globe; clicking a region opens its panel; numbers match `region_stat`. (built: `observatory.tsx`; checked in Loop 2)
- [x] T3.9 Losses and honest-customer declines are computed against ground truth inside reducers and never expose an agent's kind to the client. (`agent_truth` is private; `settleRefund` updates `region_stat.lossCents` / `honestDeclines` in the module)

## Gate G4 Factory Detector Lab
- [x] T4.1 Each of the four triggers enqueues a `lab_job`. (module test "a dismissal enqueues an event job; two needs_review enqueue an agent job; the tick enqueues a schedule job"; user trigger is the `enqueueLab` reducer)
- [x] T4.2 The permission handler cancels a write outside `candidates/<job>/`, any other command, web tools. (`worker/test/lab-fence.test.ts`)
- [ ] T4.3 A real job on the laptop streams plan, tool calls, diff and metrics to `/lab` live.
  - UNVERIFIED-LIVE: Factory: on `/lab` ask Droid with a preset goal, with `FACTORY_API_KEY` set on the worker
- [ ] T4.4 Promote copies the candidate to `detectors/live/` with a version bump; the next detector run uses it and pattern cards show the new version. (promotion code tested: "promotion fixes import paths and bumps the version"; the end-to-end promote needs a real candidate)
  - UNVERIFIED-LIVE: Factory: press Promote on a finished job on `/lab`

## Gate G5 Home page and credentials
- [x] T5.1 Home matches Constructa's section order and look, with the recoloured moving background. (`e2e/shots/home-vs-constructa.png`)
- [x] T5.2 Hero counters are Live and tick up. (badge check ok on `/`)
- [ ] T5.3 The live demo loops: each verification step lights up when its row arrives; CREAO steps carry "Replay of real run" and a real run link. (loops with the showcase replay: "Credit 684 → 696"; the CREAO steps are fixture until a real run is recorded)
  - UNVERIFIED-LIVE: CREAO: `curl -X POST localhost:8787/showcase/run -H 'content-type: application/json' -d "{\"code\":\"$DEMO_CONTROLLER_CODE\"}"`
- [x] T5.4 Credential issue, present, verify: five steps animate and pass; Tamper fails step 4; Revoke fails step 3; expired fails step 3. (`worker/test/credentials.test.ts`)
- [x] T5.5 The Investigator receives the verification result and cites it. (orchestrator sends `credential` in the case; worker test "T5.5 the Investigator cites a verified credential")

## Gate G6 Ship
- [ ] T6.1 The demo script runs twice in a row from `demo-reset` with no manual fixes.
- [x] T6.2 README has CREAO agent IDs and run links; where and how Droid is used; how SpacetimeDB is used; real versus simulated; setup; limits. (IDs and links are `<fill in>` until the agents exist)
- [ ] T6.3 Devpost draft submitted with CREAO, SpacetimeDB and Factory tracks, teammates, video. (humans)
- [x] T6.4 Secret scan clean; `NEXT_PUBLIC_DATA=fixture` build fails as designed. (`grep` for `capi_`/`cr_sk_` values over the repo and `web/.next/static`: none; fixture build: "refusing to build fixture data into a deployable app"; a normal `next build` succeeds)

## Log
- 11:05 Pivoted the scaffold to Vouch World: removed Threadline/ml/seed/CRS/Nessie, rewrote AGENTS.md. Module (31 tables, engine in sim.ts) published to a local SpacetimeDB 2.13 in the session; tick runs at 5/s with 10,000 agents.
- 12:34 Bench on the cloud VM (Xeon 2.10 GHz × 4): 176k / 197k / 189k agent-steps/s at 10k / 50k / 100k agents, stored in `bench_result`.
- 12:44 `demo-reset` used a 720-day cap, so the sim stopped and the T1.5 e2e failed; it now uses `DEFAULT_MAX_DAY` (1,500). e2e 4/4 green.
- 12:52 Docs written: README, docs/{VERIFIED, REAL_VS_SIMULATED, LIVE_CHECKLIST, SETUP, ARCHITECTURE, CREAO, HYPHENATE}.md, .env.example with Appendix B names. Next: Loop 2.
