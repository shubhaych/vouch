# Vouch World progress
Loop: 3 done (QA_REPORT.md) | Gate: G6, live checks left | Sim day: live on /system | Last green e2e: 2026-10-24 12:46 UTC (`npx playwright test e2e/`, 4/4)

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
- [x] T0.6 `hello-droid.ts` streams one message from a Droid session on the laptop (human-run). Code done; type-checks against `@factory/droid-sdk` 0.10.0. (Run on the laptop, 2026-10-24: "A fraud detector is a system that identifies suspicious activity that may indicate fraud." / `[result] success=true`.)

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
- [x] T2.2 Upload rejects a wrong nonce, a stale claim, and a video under 4 seconds. (`qa/matrix.ts`: NONCE 403, V14 410 after 11 minutes, V12 422 "That video is 2.1 seconds…", V13 422)
- [x] T2.3 The worker extracts 8 to 10 frames including the first and last second, stores hashes, calls `attachVideo`. (`npx tsx scripts/claim-flow.ts`: "9 frames, 8.0 s 640x480")
- [x] T2.4 Frame reuse: uploading the same video for a second claim shows "Matches frames from claim ...". (claim-flow twice; `worker/test/video.test.ts` matches a re-encoded copy)
- [x] T2.5 The orchestrator runs Evidence Analyst then Investigator; `/business` shows both runs progressing, then findings with boxes and a recommendation with cited reasons. (fixture mode, labelled Fixture; worker log "C-14: Investigator recommends accept $249.00 (fixture)")
  - UNVERIFIED-LIVE: CREAO: `CREAO_MODE=live npm run worker` then `npx tsx scripts/claim-flow.ts`
- [x] T2.6 Unparseable agent output fails closed (`unable_to_verify`, `more_evidence`). (worker test "app path: … unparseable output fails closed")
- [x] T2.7 Kill switch off: a new claim gets "Investigator offline" and no CREAO run starts. (module test "with no recommendation a person can only request more evidence"; orchestrator checks the switch before each run and before the proposal; end to end in Loop 2)
- [x] T2.8 Accept writes a decision, a balanced journal entry and +12 credit; the phone shows the decision and the score tween; the globe shows the arc and the credit event. (module test "T2.8 accept pays +12…"; e2e "T2.1/T2.8": credit 600 → 612)
- [x] T2.9 The proposer identity cannot call `decide`; a refund above $500 requires the controller. (module tests)

## Gate G3 Vouch World features
- [x] T3.1 Clicking an agent opens its panel with tiles, chips, credit progression and timeline. (e2e T1.5/T1.6 opens `agent-panel`)
- [x] T3.2 Clicking a graph point opens the exact purchase or refund that caused it. (`qa/personas.spec.ts` P7: credit dot → `cause-card`; `qa/shots/P7-cause-card.png`)
- [x] T3.3 The three detectors run every 5 simulated days and write patterns with `pattern_event` rows and `why` lines. (worker log "detectors on day 130: … 3 new patterns"; 284 patterns and 23,898 pattern_event rows by day 720)
- [x] T3.4 Shuffling regions does not change `coordinated` output (worker test; also `detectors/test.ts`).
- [x] T3.5 The evaluator prints precision, recall and honest-agents-flagged per detector on a fresh seed. (`npx tsx detectors/eval.ts --live --seed 23`: coordinated 100.0% precision, 100.0% ring recall, 0/2,469 honest flagged)
- [x] T3.6 Replay: clicking a pattern fits the camera, dims the rest, and the scrubber plays purchases, deliveries, refunds and the detection moment in sync with the list. (P7: pattern → replay panel, scrubber, play, event list; `qa/shots/P7-replay.png`)
- [x] T3.7 The Pattern Analyst reviews a flagged pattern once; Confirmed applies −120 to each core agent; Dismissed applies nothing. (module test "confirm applies -120 to core agents only…"; fixture mode reviews at most 12 per run)
  - UNVERIFIED-LIVE: CREAO: the next new pattern with `CREAO_MODE=live` gets one Pattern Analyst run
- [x] T3.8 Observatory: each of the seven metrics re-colours the globe; clicking a region opens its panel; numbers match `region_stat`. (`e2e/regressions/QA-008.spec.ts`: seven switches in 1.2–4.9 s headless, region panel opens; the panel reads `region_stat` rows directly)
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
- [x] T6.1 The demo script runs twice in a row from `demo-reset` with no manual fixes. (`npx tsx scripts/demo-reset.ts && npx playwright test e2e/demo.spec.ts --repeat-each 2`: 2 passed in 6.7 min. It covers every step of the 4-minute script in fixture mode: home, Live world, agent panel → cause, phone claim, business with the kill switch off/on and accept, Replay, Observatory → region, lab. Log: `qa/results-demo-T6.1.log`.)
  - UNVERIFIED-LIVE: the same script with live CREAO runs and a real phone video, rehearsed twice by the team on the laptop (`npm run build && npm run start`).
- [x] T6.2 README has CREAO agent IDs and run links; where and how Droid is used; how SpacetimeDB is used; real versus simulated; setup; limits. (IDs and links are `<fill in>` until the agents exist)
- [ ] T6.3 Devpost draft submitted with CREAO, SpacetimeDB and Factory tracks, teammates, video. (humans)
- [x] T6.4 Secret scan clean; `NEXT_PUBLIC_DATA=fixture` build fails as designed. (`grep` for `capi_`/`cr_sk_` values over the repo and `web/.next/static`: none; fixture build: "refusing to build fixture data into a deployable app"; a normal `next build` succeeds)

## Gate G7 The video reviewer (Factory)
- [x] T7.1 A live claim with a video is reviewed end to end: ingest → transcript and integrity lanes → claims → Case Analyst (Droid) → proof clips → Report Auditor (Droid) + the worker's audit → score and tier → report.json/.md → CREAO Refund Reviewer → proposal; the phone shows each step as its `analysis_step` row changes and `/business` shows the report. (`npx tsx scripts/claim-flow.ts qa/videos/S04-fresh.mp4` against a local SpacetimeDB: "C-5: T4 More evidence in 155 s (3 Droid sessions, reviewer fixture)"; `worker/cases/5/{report.md,droid.log}`)
- [x] T7.2 No `FACTORY_API_KEY`: the review finishes with automated checks only, the tier is capped at T3, the phone says "Automated checks only" and the worker logs `UNVERIFIED-LIVE: factory`. (claim-flow S01 → C-2: T4 in 2 s; `worker/test/review-claims.test.ts` "lanes-only never pays out")
- [x] T7.3 The Case Analyst is a Droid session fenced to its case folder: it may Read anything in the case, run the seeded probes or its own `work/*.py`, write only through `cat > work/<file> <<'EOF'`, and call only its vouch-case tools; everything else is cancelled and the cancellation is explained back to Droid, which carries on. (C-5: first turn cancelled on an unquoted heredoc, nudge 1 recovered and recorded 3 findings in 55 s; C-6: 3 findings in 64 s with no cancellation; `worker/test/review-fence.test.ts`, 15 tests)
- [x] T7.4 The Report Auditor (Droid) writes `work/audit_test.py`, runs it and records one verdict per finding; the worker's own audit runs on top and a rejection by either sticks. (C-5: Droid rejected all three findings because `list_artifacts` returned no sha256 and clips were capped at 8 s against an 8.5 s window; both fixed. C-6: "Checks (a)-(e) passed: all 3 cited artifact hashes match; … ffprobe clip duration 11.0 s >= 9.5 s" for every finding, worker audit agreed, report lists the three findings with clips; `worker/test/review-audit.test.ts`, 6 tests)
- [x] T7.5 Scoring, tiers and credit follow the spec formula (v1) and never produce a decline: T4 asks for more evidence, T5 asks for a person. (`module/src/review-score.test.ts`, 17 tests incl. the worked examples; live runs C-2…C-6 all T4 on synthetic footage)
- [x] T7.6 `autoDecide` pays a T1/T2 only within the auto-approve limit, only after the Refund Reviewer agreed, only once, and only for the worker identity. (`module/src/review.test.ts` "autoDecide")
- [ ] T7.7 Spoken claims: a video with speech is transcribed (faster-whisper) and claims come from the transcript with `tSaid`; the QA videos have no audio track, so every live run so far used the written reason.
  - UNVERIFIED-LIVE: `pip install faster-whisper` on the worker, then `npx tsx scripts/claim-flow.ts <video with speech>`
- [ ] T7.8 Proof Builder as a Droid session (`REVIEW_DROID_PROOF=1`); by default the worker cuts the same clips deterministically.
  - UNVERIFIED-LIVE: Factory: `REVIEW_DROID_PROOF=1 npm run worker` then a claim-flow run
- [ ] T7.9 CREAO Refund Reviewer and Customer Liaison live (saved agents `CREAO_REFUND_REVIEWER_*`, `CREAO_CUSTOMER_LIAISON_*`); fixtures in `worker/fixtures/refund_reviewer.*.json`, `customer_liaison.message.json`.
  - UNVERIFIED-LIVE: CREAO: `CREAO_MODE=live npm run worker` then a claim-flow run
## Log
- 11:05 Pivoted the scaffold to Vouch World: removed Threadline/ml/seed/CRS/Nessie, rewrote AGENTS.md. Module (31 tables, engine in sim.ts) published to a local SpacetimeDB 2.13 in the session; tick runs at 5/s with 10,000 agents.
- 12:34 Bench on the cloud VM (Xeon 2.10 GHz × 4): 176k / 197k / 189k agent-steps/s at 10k / 50k / 100k agents, stored in `bench_result`.
- 12:44 `demo-reset` used a 720-day cap, so the sim stopped and the T1.5 e2e failed; it now uses `DEFAULT_MAX_DAY` (1,500). e2e 4/4 green.
- 13:10 Loop 2 (fixture mode): QA_REPORT.md with 12 issues (1 P0, 6 P1 incl. QA-008 raised from P2, 2 P2, 3 P3).
- 14:15 Loop 3 rerun: matrix 13/13; e2e smoke 4/4; regressions pass. It found QA-013 (stale credential in the stepper; renewal re-issued behind a revocation) and QA-014 (/world layer rebuilds saturating the main thread). Both were fixed (QA-014 partly; the rest is software WebGL, measure on the laptop). The demo uses `npm run build && npm run start`.
- 13:33 Loop 3: all P0/P1/P2 fixed with a regression test each (module 21, worker 23 unit tests; e2e/regressions/QA-007..009); short Loop 2 rerun from demo-reset.
- 12:52 Docs written: README, docs/{VERIFIED, REAL_VS_SIMULATED, LIVE_CHECKLIST, SETUP, ARCHITECTURE, CREAO, HYPHENATE}.md, .env.example with Appendix B names. Next: Loop 2.
- 16:25 Video reviewer built on the Factory SDK (spec "Vouch Refund Flow", Oct 24): `module/src/review{,-score,-types}.ts` (7 tables, reducers incl. `autoDecide`, formula v1), `worker/src/review/*` (ingest, lanes, Droid Case Analyst / Proof Builder / Report Auditor sessions behind a permission fence, worker-cut proof clips, deterministic audit, report, CREAO Refund Reviewer + Customer Liaison seats with fixtures), `worker/tools/` probes, `/claim` stepper with live notes and the `/business` report panel. Live on the laptop against a local SpacetimeDB: C-2 (no key, lanes only, 2 s), C-3…C-5 (Droid live; each run exposed a fence or tool gap, fixed: `Script` batches, quoted heredocs as the only file writer, nudges when a session stops early, `list_artifacts` without sha256, 8 s clip cap), C-6 (clean: 3 findings, auditor passed all, 150 s). Also fixed: `refund_investigator` accept fixture without `reasons` crashed the adapter (QA-004 test now uses the fixture's confidence). Not verified live: faster-whisper transcript lane (not installed; QA videos are silent), Proof Builder as a Droid session, CREAO Reviewer live, T1/T2 auto-decide (synthetic footage never reaches T1).
