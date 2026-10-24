# Vouch World progress
Loop: 1 Build | Gate: G0 | Sim day: (live on /system) | Last green e2e: none yet

Environment for this session: local SpacetimeDB 2.13.0 standalone on `ws://localhost:3011` (installed in the cloud session, `spacetime start`), not Maincloud. "Live" below means against that running server.

## Blocked (humans)
- BLOCKED: create the three CREAO agents in agent.creao.ai (Appendix A) and put an account key (`cr_sk_`) in `CREAO_API_KEY`. The session has one app-scoped `capi_` key and no app id, so no agent can be called yet.
- BLOCKED: record the real claim videos V01-V07, V15, V16 on a phone into `qa/videos/`.
- BLOCKED: `FACTORY_API_KEY` and the `droid` CLI exist only on the demo laptop.

## Gate G0 Foundations
- [ ] T0.1 Monorepo with `module`, `web`, `worker`, `detectors`; `npm run typecheck` passes.
- [ ] T0.2 `web/DESIGN.md` with Constructa's tokens, section order and background component; `e2e/constructa-ref.png` saved.
- [ ] T0.3 Module publishes; `hello-stdb.ts` inserts a row and two browser tabs both show it live.
- [x] T0.4 The scheduled tick fires: `sim_run.day` advances on its own. (`spacetime sql vouch "SELECT day, cursor FROM sim_run" -s dev3011`: day 120 → 149 in ~60 s; metrics.last_tick_micros 199394 at 5 ticks/s with 10,000 agents)
- [ ] T0.5 `hello-creao.ts` starts one run per saved agent and gets a result (human-run; response saved as a fixture).
- [ ] T0.6 `hello-droid.ts` streams one message from a Droid session on the laptop (human-run).

## Gate G1 The economy
- [ ] T1.1 `seedWorld(seed=11, population=10000)` creates 10,000 agents, 60 businesses, 40 regions; seeding twice without force is refused.
- [ ] T1.2 Same seed, same first 1,000 events (determinism test in module tests).
- [ ] T1.3 Every score change has a `credit_event` with a cause (test: random 200 agents).
- [ ] T1.4 `region_stat` totals equal the sums over `purchase` and `refund` (test after 30 days).
- [ ] T1.5 `/world` renders 10,000 agent points and businesses; arcs appear for new purchases within 1 second of the row; 45 fps or better on the demo laptop.
- [ ] T1.6 The live event monitor streams `event_feed`; clicking a line selects the agent.
- [ ] T1.7 `/system` shows row counts, agent-steps per second, events per second and ping p50/p95, all badged Live.

## Gate G2 One live claim, end to end
- [ ] T2.1 `/shop`: a fresh visitor gets an agent, buys an item, fast-forwards, requests a refund; the QR opens `/claim/[id]` on a phone.
- [ ] T2.2 Upload rejects a wrong nonce, a stale claim, and a video under 4 seconds.
- [ ] T2.3 The worker extracts 8 to 10 frames including the first and last second, stores hashes, calls `attachVideo`.
- [ ] T2.4 Frame reuse: uploading the same video for a second claim shows "Matches frames from claim ...".
- [ ] T2.5 The orchestrator runs Evidence Analyst then Investigator; `/business` shows both runs progressing, then findings with boxes and a recommendation with cited reasons.
- [ ] T2.6 Unparseable agent output fails closed (`unable_to_verify`, `more_evidence`).
- [ ] T2.7 Kill switch off: a new claim gets "Investigator offline" and no CREAO run starts.
- [ ] T2.8 Accept writes a decision, a balanced journal entry and +12 credit; the phone shows the decision and the score tween; the globe shows the arc and the credit event.
- [ ] T2.9 The proposer identity cannot call `decide`; a refund above $500 requires the controller.

## Gate G3 Vouch World features
- [ ] T3.1 Clicking an agent opens its panel with tiles, chips, credit progression and timeline.
- [ ] T3.2 Clicking a graph point opens the exact purchase or refund that caused it.
- [ ] T3.3 The three detectors run every 5 simulated days and write patterns with `pattern_event` rows and `why` lines.
- [ ] T3.4 Shuffling regions does not change `coordinated` output (test).
- [ ] T3.5 The evaluator prints precision, recall and honest-agents-flagged per detector on a fresh seed.
- [ ] T3.6 Replay: clicking a pattern fits the camera, dims the rest, and the scrubber plays purchases, deliveries, refunds and the detection moment in sync with the list.
- [ ] T3.7 The Pattern Analyst reviews a flagged pattern once; Confirmed applies −120 to each core agent with an animation; Dismissed applies nothing.
- [ ] T3.8 Observatory: each of the seven metrics re-colours the globe; clicking a region opens its panel; numbers match `region_stat`.
- [ ] T3.9 Losses and honest-customer declines are computed against ground truth inside reducers and never expose an agent's kind to the client.

## Gate G4 Factory Detector Lab
- [ ] T4.1 Each of the four triggers enqueues a `lab_job`.
- [ ] T4.2 The permission handler cancels a write outside `candidates/<job>/`, any other command, web tools.
- [ ] T4.3 A real job on the laptop streams plan, tool calls, diff and metrics to `/lab` live.
- [ ] T4.4 Promote copies the candidate to `detectors/live/` with a version bump; the next detector run uses it and pattern cards show the new version.

## Gate G5 Home page and credentials
- [ ] T5.1 Home matches Constructa's section order and look, with the recoloured moving background.
- [ ] T5.2 Hero counters are Live and tick up.
- [ ] T5.3 The live demo loops: each verification step lights up when its row arrives; CREAO steps carry "Replay of real run" and a real run link.
- [ ] T5.4 Credential issue, present, verify: five steps animate and pass; Tamper fails step 4; Revoke fails step 3; expired fails step 3.
- [ ] T5.5 The Investigator receives the verification result and cites it.

## Gate G6 Ship
- [ ] T6.1 The demo script runs twice in a row from `demo-reset` with no manual fixes.
- [ ] T6.2 README has CREAO agent IDs and run links; where and how Droid is used; how SpacetimeDB is used; real versus simulated; setup; limits.
- [ ] T6.3 Devpost draft submitted with CREAO, SpacetimeDB and Factory tracks, teammates, video.
- [ ] T6.4 Secret scan clean; `NEXT_PUBLIC_DATA=fixture` build fails as designed.

## Log
- 11:05 Pivoted the scaffold to Vouch World: removed Threadline/ml/seed/CRS/Nessie, rewrote AGENTS.md. Module (31 tables, engine in sim.ts) published to a local SpacetimeDB 2.13 in the session; tick runs at 5/s with 10,000 agents. Next: bindings, web shell, hello-stdb, tests.
