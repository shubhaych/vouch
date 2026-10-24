# What is real, what is simulated

One line per thing, with the command or screen that checks it. On screen, every number carries a badge:
- **Live:** computed now from SpacetimeDB rows.
- **Simulated:** from the agent simulation.
- **Fixture:** recorded or hand-written test data.
- **Replay:** the replay of a real run.

In this build "Live" means a local SpacetimeDB 2.13.0 server; Maincloud is step 1 of [LIVE_CHECKLIST.md](LIVE_CHECKLIST.md).

| Thing | Status in this build | How to check |
| --- | --- | --- |
| SpacetimeDB tables, reducers, subscriptions, the scheduled tick | **Live** (local server) | `spacetime sql vouch "SELECT day, running FROM sim_run" -s <server>` twice; the day advances |
| Row counts, events/s, agent-steps/s, ping p50/p95 on `/system` and the home counters | **Live**, from `metrics` and `latency_ping` | `/system`; `npx tsx scripts/hello-stdb.ts 50` |
| Bench results (10k/50k/100k agents) | **Live** measurements, with the date and machine stored in `bench_result` | `npx tsx scripts/bench.ts` |
| The 10,000 agents, 60 businesses, 40 regions, purchases, refunds, credit events | **Simulated** by `module/src/sim.ts`, deterministic from the seed (11 for the demo) | `npm test -w module` (T1.2 determinism) |
| Agent positions on the globe | **Simulated** home regions, spread up to 3° for visibility; no real locations | `/world` shows "Simulated agents. Vouch does not track real locations." |
| Agent kinds (honest, opportunist, serial, ring) | **Simulated** ground truth in the private `agent_truth` table; never sent to a browser | `module/src/schema.ts` (not public); T3.9 |
| Losses and honest-customer declines (Observatory) | **Simulated**, computed against the ground truth inside reducers | `region_stat` columns `loss_cents`, `honest_declines` |
| The shopper's join, purchase and refund request on `/shop` | **Live** rows; the payment is simulated (no money moves) | `/shop`, then `SELECT * FROM purchase WHERE source = 'live'` |
| Claim video: upload, ffprobe, frames, dHash, freshness, blank-frame and reuse checks | **Live** (ffmpeg in the worker) | `npx tsx scripts/claim-flow.ts` |
| Evidence Analyst, Refund Investigator, Pattern Analyst results | **Fixture** (`CREAO_MODE=fixture`, hand-written to the agents' schemas in `worker/fixtures/`); live runs not yet made | `/business` badges; LIVE_CHECKLIST.md step 2 |
| The showcase run on the home page (A-00421) | **Replay** of the recorded showcase sequence; the CREAO steps are fixture until a real run is recorded | `worker/fixtures/showcase/recorded.json` |
| Decisions, segregation of duties, journal entries | **Live** reducers (`module/src/desk.ts`); the ledger is a demo ledger, not real books | `npm test -w module` (T2.8, T2.9) |
| Detectors and the patterns they flag | **Live** code over **Simulated** history | the worker log line "detectors on day N" |
| Detector precision and recall | Measured on fresh simulated worlds against the simulation's ground truth; not real fraud | `npx tsx detectors/eval.ts --live --seed 23` |
| Droid Detector Lab jobs | **Not run here** (no Droid in the cloud session). The fence and the pipeline are unit tested; jobs fail with "Droid unavailable here; nothing was run." | `npm test -w worker` (lab-fence); LIVE_CHECKLIST.md step 3 |
| Credentials | Real Ed25519 signatures and salted SHA-256 digests; simulated issuers (the 60 simulated businesses); registry in SpacetimeDB, not on a public chain | `npm test -w worker` (credentials: tamper, revoke, expiry) |
| Credit score | **Simulated**, illustrative 0–1000 shopping score, not a consumer report | `module/src/score.ts` |
