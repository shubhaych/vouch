# Vouch World

Refund fraud costs businesses money, and the usual fraud controls punish honest shoppers. Vouch handles both. Ten thousand simulated shoppers buy and return goods inside a SpacetimeDB database. A real person can join from a phone, buy, record a damaged item and watch the refund get decided live: a fenced Factory Droid session investigates the video claim by claim, a CREAO Refund Reviewer checks the report, and the business decides from a tiered recommendation. Saved CREAO agents also confirm fraud patterns, and a second Droid fence writes and tests new fraud detectors in the lab.

Started during Cal Hacks 13.0. First commit: `cc89a17`, 2026-10-23 20:57:05 -0700.

| Page | What it shows |
| --- | --- |
| `/` | Home page in Constructa's format. A live demo panel runs a purchase through to a verified refund and a credit change. |
| `/world` | The globe: 10,000 agents, 60 businesses, purchase and refund arcs, the event monitor, agent panels, the Fraud Replay and the Observatory. |
| `/shop`, `/claim/[id]` | The shopper's phone flow: join, buy, fast-forward, request a refund, record a video holding up the requested number of fingers, then watch the reviewer's steps (received, transcribed, frames, integrity, Droid investigating, proof, audit, score, reviewed, decision). |
| `/business` | The refunds desk: the CREAO org chart with the kill switch, the video reviewer's report (tier, proof reel with a timeline, one finding per spoken claim with clips, integrity, history, score, the Reviewer's opinion, how it was investigated, limits), the five-step credential check, the recommendation, the decision. |
| `/desk` | The opt-in Refund Finance Desk: the seeded 100-company portfolio, return obligations and the featured-company close view. Set `NEXT_PUBLIC_DESK=1` for the Finance impact link; set `FINANCE_DESK=1` for the worker's isolated book and close endpoint. |
| `/lab` | The Droid Detector Lab: queued jobs, the plan, tool calls, the diff, scores on a fresh world, promote or reject. |
| `/system` | Live row counts, agent-steps per second, events per second, ping p50/p95, and benchmark results. |

Every number on screen carries a badge: **Live** means computed now from SpacetimeDB rows, **Simulated** means it comes from the agent simulation, **Fixture** means recorded test data, and **Replay** means the replay of a real run. The agents are synthetic: "Simulated agents. Vouch does not track real locations."

## Refund Finance Desk (in progress)

The Desk is a company-finance add-on to the existing refund flow. It tracks the refund's effect on the company's revenue, cash, conditional return obligations, reserve and forecast, with a separate controller review. The first slice includes a reproducible one-million-order DuckDB book, a read-only three-way reconciliation, and a SpacetimeDB-backed portfolio view. Generated book data and portfolio activity are simulated; no finance CREAO agents are connected yet. See [FINANCE_STATUS.md](FINANCE_STATUS.md) for the current gate and limits.

Seats: returns accountant, cash reconciler, returns analyst, on an e-commerce finance team; the controller signs off.

## CREAO: the agents do the core work

Three saved agents, built on agent.creao.ai, fill the investigation seats. The worker (`worker/src/creao.ts`, `worker/src/orchestrator.ts`) starts their runs, polls every 15 s (or takes the webhook), checks the JSON they return and writes it through reducers. An agent never writes to the database and never moves money.

| Agent | Agent ID | Run share link | What it does |
| --- | --- | --- | --- |
| Evidence Analyst | `<fill in>` | `<fill in>` | Reads the claim's video frames and the deterministic checks. Returns findings with boxes and a verdict: consistent, inconsistent or unable_to_verify. |
| Refund Investigator | `<fill in>` | `<fill in>` | Reads the findings, the shopper's history, any credential check and the store's policy. Proposes accept, store credit, more evidence or decline, citing reasons. |
| Pattern Analyst | `<fill in>` | `<fill in>` | Reads a flagged pattern's events and the agents' histories. Returns confirm, dismiss or needs_review, with each agent's role and a narrative. |

**Remove the agents and no claim is investigated and no fraud pattern is confirmed.**

**Kill switch.** Open `/business` and take the business seat with the demo code. In the org chart, click the CREAO switch.
- New claims then show "Investigator offline", and the business can only ask for more evidence. Nothing is declined automatically.
- Flagged patterns wait in `awaiting_review`.
- The worker checks the switch before every run and again before every proposal. Click it again to turn the agents back on.

The agents' instructions and setup steps are in [docs/CREAO.md](docs/CREAO.md). In this repository's test runs the agents were replaced by hand-written fixtures in `worker/fixtures/`, labelled Fixture on screen. See [docs/LIVE_CHECKLIST.md](docs/LIVE_CHECKLIST.md) for the live runs still to do.

## Factory: the video reviewer

Every refund claim with a video is investigated by Droid sessions that run on the worker through `@factory/droid-sdk` (`worker/src/review/`). This is the part of Vouch that would be hard to build without Factory: the reviewer is not a prompt that returns a verdict, it is an agent that works inside a case folder, measures the footage with real tools, and leaves a complete, auditable trail that the business page shows.

**The pipeline for one claim** (`worker/src/review/runner.ts`; every step is an `analysis_step` row, so the phone shows progress live):

1. **Ingest.** ffmpeg normalises the upload to `cases/<claim>/video.mp4`, extracts `audio.wav`, samples frames every 0.5 s and at scene changes, and builds 3×3 contact sheets with the time burnt into each tile, so one `Read` shows Droid 4.5 s of video.
2. **Lanes.** The transcript lane (faster-whisper, word timestamps) and the integrity lane (black and frozen frames, cut rate, frame reuse against earlier claims, metadata, the finger challenge) run in parallel. One Droid call turns the transcript (or the written reason) into **spoken claims** with the moment each was said.
3. **Case Analyst (Droid, fenced).** A Droid session opens in the case folder with `CASE.md`, the frames, the mosaics and a set of read-only probes (`worker/tools/probes/`: luminance of a region over time, sound onsets, part motion, screen-recapture hints, OCR). It plans, looks at the moments each claim points to, runs probes or writes its own, and records **exactly one finding per claim** (supports / contradicts / neutral) plus integrity findings through the `vouch-case` MCP server. Every finding must cite a time window and an artifact it registered.
4. **Proof.** For each finding a captioned clip and a still are cut, plus a 20–40 s proof reel. The worker cuts them by default; `REVIEW_DROID_PROOF=1` runs the Proof Builder as a second Droid session instead (same files).
5. **Report Auditor (Droid) and the worker's own audit.** The auditor writes and runs a test over every finding (artifact exists and its hash matches, window inside the video, proof clip covers it, wording describes footage and never the person, one finding per claim). The worker runs the same checks itself; a rejection by either sticks, and rejected findings stay in the report under "Rejected by the audit".
6. **Score, tier, recommendation.** The deterministic formula in `module/src/review-score.ts` (shared with the web) turns evidence support, coverage, integrity and account history into P(legit) and a tier: T1 refund now, T2 partial now and the rest on return, T3 refund on return, T4 more evidence, T5 a person decides. Nothing ever auto-denies.
7. **CREAO Refund Reviewer.** The saved agent reads the report and says whether it agrees; auto-decision happens only for T1/T2, under the store's limit, when the Reviewer agrees. A Customer Liaison agent writes the customer message.

**What makes it a Factory feature.**
- *A fenced agent, not a prompt.* The Droid SDK's permission handler (`worker/src/review/fence.ts`, 15 unit tests) sees every tool call before it runs, including each call inside a `Script`, and cancels anything outside the case: the Case Analyst may write only `work/`, run only `python3`/`node` on its own scripts or the shared probes, `ffmpeg`/`ffprobe` writing into `work/`, and the role's `vouch-case` tools; the web and subagents are disabled. Droid can write its own probe when none fits.
- *Custom tools through `createSdkMcpServer`.* `get_case`, `add_artifact`, `add_finding`, `audit_finding`, `set_live_note`, `vision_label` are in-process MCP tools backed by SpacetimeDB reducers, so every artifact and finding is a row the business page subscribes to while the session is still running.
- *Nested sessions with a budget.* `vision_label` runs a short nested Droid call over a frame; every session, retry and nested call counts against `MAX_DROID_SESSIONS_PER_HOUR`.
- *Visible work.* The plan, every command with its exit code and duration, every fence decision and every message is in `cases/<claim>/droid.log`, linked from the report, and summarised under "How this was investigated".
- *Graceful degradation.* No key, no budget or a failed session means "Automated checks only": the lanes still run, the report says so, the tier is capped at T3, and the business decides.

**Verified live on the laptop (2026-10-24):** the fixture-mode run of the full pipeline, and real Droid sessions through the SDK (claims extraction, session start, MCP tools, fence decisions for direct calls and for `Script` batches). The last run (`qa/videos/S05-fresh.mp4` → C-6) took 150 s with three sessions: the Case Analyst wrote its plan and an audio-track probe, registered mosaics, frames and the probe's chart, and recorded three findings; the worker cut the clips and reel; the Report Auditor wrote and ran `work/audit_test.py`, verified every hash and clip and passed all three; the worker's audit agreed. The QA videos are synthetic and silent, so the tier was T4 "more evidence" every time, never a decline. Two facts found the hard way, both in [docs/VERIFIED.md](docs/VERIFIED.md): with autonomy *off* the session has no file-write tool (Droid writes files through `Execute`, which the fence judges), and with autonomy *low* file writes bypass the permission handler, so the reviewer stays on *off*. The transcript lane needs `pip install faster-whisper`; without it the report says "no transcript" and claims come from the written reason.

## Factory: the Detector Lab

`worker/src/lab.ts` runs a Droid SDK session when a lab job is enqueued. Four things can enqueue one:
- an event (a person overrides a recommendation, or a pattern is dismissed),
- a schedule (every 30 simulated days),
- a user action (one of five preset goals on `/lab`),
- another agent (the Pattern Analyst returns needs_review twice).

Droid may only edit `detectors/candidates/<job>/` and run two commands. The permission handler cancels everything else. Its plan, every tool call, the diff and the evaluator's scores are stored in SpacetimeDB and shown on `/lab`. A person promotes or rejects the candidate.

Permission rules (`decideTool` in `worker/src/lab.ts`, unit tested in `worker/test/lab-fence.test.ts`):
- Writes and edits are allowed only inside `candidates/<job>/` of the job's own workspace copy. Any path outside it is cancelled, including one that climbs out with `..`. Droid cannot make a symlink, because its only shell access is the two commands below.
- Exactly two shell commands are allowed: `npx tsx test.ts candidates/<job>` and `npx tsx eval.ts --candidate candidates/<job> [--json] [--seed N] [--agents N]`.
- The web tools (`WebSearch`, `FetchUrl`) and every MCP server except `vouch-lab` are disabled; any other tool type is cancelled.
- At most 6 jobs run per simulation run. No job starts itself. Promotion bumps the version, reruns the tests, and restores the old detector if they fail.

A lab job's recorded events: `<fill in>` (written to `worker/fixtures/lab/job-<n>.json` after the first real job on the laptop).

## SpacetimeDB: the economy lives in the module

- **The simulation is a scheduled reducer.** `sim_tick` schedules `tick` every 200 ms. Each tick steps 1,000 agents through the shared engine (`module/src/sim.ts`): purchases, deliveries, refund intents, fast decisions, investigations, ring bursts and credit changes. The engine is deterministic from a seed; its RNG state lives in `sim_run.rngState`.
- **Ground truth stays private.** An agent's kind (honest, opportunist, serial, ring) is in the private `agent_truth` table. Losses and honest-customer declines are computed against it inside reducers, so the client never sees who is who.
- **Segregation of duties is enforced by reducers** (`module/src/desk.ts`):
  - the worker proposes; a business seat or the controller decides; the poster writes the journal entry;
  - whoever proposes cannot decide;
  - an accept above $500 needs the controller;
  - an entry that does not balance is refused.
- **Tables (31).**
  - Public: `role`, `sim_run`, `agent`, `business`, `purchase`, `refund`, `credit_event`, `event_feed`, `region_stat`, `fraud_pattern`, `pattern_event`, `claim`, `evidence`, `agent_run`, `control`, `decision`, `journal_entry`, `journal_line`, `credential`, `verification`, `lab_job`, `lab_event`, `metrics`, `latency_ping`, `bench_result`.
  - Private: `seat_code`, `counter`, `sim_tick`, `agent_truth`, `shopper_link`, `refund_intent`.
- **Subscription strategy: keep the browser light.**
  - `/world` subscribes to `agent`, `business`, `region_stat` and the 512-row `event_feed` ring, and re-renders on a throttle.
  - Panels subscribe to one agent's rows with `where` filters, only while open.
  - `/claim/[id]` subscribes to its own claim, refund, runs and decision.
  - The shopper's identity is linked to their agent through the `my_agent` view.
  - The worker keeps its own indexed mirror (`worker/src/mirror.ts`), because the client cache's `find()` scans every row.

**Numbers.** Measured 2026-10-24 on a cloud VM (Intel Xeon @ 2.10 GHz × 4) against a local SpacetimeDB 2.13.0 standalone server:

| Measure | Result |
| --- | --- |
| Live run, seed 11, 10,000 agents | 5 ticks/s, 1,000 agents per tick. Measured tick interval 203 ms. By simulated day 720: 201,460 purchases, 29,747 refunds and 288,423 credit events. |
| Reducer round trip (`npx tsx scripts/hello-stdb.ts 50`) | p50 2 ms, p95 4 ms |
| Unthrottled bench, 30 simulated days (`npx tsx scripts/bench.ts`) | 10,000 agents: 176,437 agent-steps/s. 50,000 agents: 196,962. 100,000 agents: 188,903. |

The bench writes its results to `bench_result`, and `/system` shows them next to the live counters. Maincloud has not been measured yet ([docs/LIVE_CHECKLIST.md](docs/LIVE_CHECKLIST.md)).

## Detectors

Three detectors live in `detectors/live/`: `coordinated` (rings), `false_defect` (opportunists) and `refund_frequency` (serial refunders). They use behaviour only: timing, repetition, claim similarity and refund-to-purchase ratio. A shared region or a shared business is never evidence; `detectors/test.ts` shuffles regions and relabels businesses to prove `coordinated` does not change.

The fixed evaluator (`npx tsx detectors/eval.ts --live --seed 23`) builds a fresh world the detectors have never seen and scores them against the simulation's ground truth:

| Detector | Flagged | Precision | Recall on its target | Honest agents flagged |
| --- | --- | --- | --- | --- |
| coordinated v1 | 70 | 100.0% | 100.0% of ring members | 0 / 2,469 |
| false_defect v1 | 139 | 100.0% | 40.7% of opportunists | 0 / 2,469 |
| refund_frequency v1 | 100 | 100.0% | 39.8% of serial refunders | 0 / 2,469 |

These numbers are measured on a simulated economy we designed. They show the method works on behaviour we modelled, not on real fraud.

## What is real and what is simulated

| Thing | Status |
| --- | --- |
| SpacetimeDB state, subscriptions, reducers, the tick, throughput and latency numbers | Live (local server in this build) |
| The 10,000 agents, their businesses, purchases and refunds | Simulated by our engine, deterministic from a seed |
| Agent regions on the globe | Simulated positions; no real locations |
| The shopper's purchase and payment | Simulated payment; the claim and the video are real |
| Video frames, hashes, freshness, blank-frame, little-motion and reuse checks | Live (ffmpeg and dHash in the worker) |
| CREAO findings, recommendations and pattern reviews | Fixture in this build (`CREAO_MODE=fixture`); live runs wait for the agents (see the checklist) |
| The video reviewer's ingest, integrity checks, findings, proof clips, audit and score | Live (ffmpeg, the probes and the formula run in the worker; findings come from a live Droid session when `FACTORY_API_KEY` is set, otherwise the report says "Automated checks only") |
| The CREAO Refund Reviewer's opinion | Fixture until the saved agent exists (labelled Fixture; "Reviewer offline" when neither is available) |
| Detector scores | Measured on fresh simulated worlds against the simulation's ground truth |
| Droid review sessions | Run live on the laptop through the SDK; see "Factory: the video reviewer" for what was verified |
| Droid lab jobs | Not run live yet; the fence and the pipeline are unit tested |
| Credentials | Real Ed25519 signatures and salted digests; simulated issuers; registry in SpacetimeDB, not on a public chain |

Line-by-line detail, with the command that checks each line: [docs/REAL_VS_SIMULATED.md](docs/REAL_VS_SIMULATED.md). Facts checked against the real libraries and services: [docs/VERIFIED.md](docs/VERIFIED.md).

## Setup

```bash
npm install
cp .env.example .env              # fill in what you have; every key is optional for local fixture mode
npm run stdb:start                # local SpacetimeDB on :3011 (or use Maincloud, docs/SETUP.md)
npm run stdb:publish && npm run stdb:generate
npm run worker                    # Fastify worker on :8787: orchestrator, video, detectors, poster, lab
npm run dev                       # web on http://localhost:3000 (for the demo: npm run build && npm run start)
npm run demo:reset                # seed 11, 10,000 agents, start the tick
npm run check                     # typecheck, module and worker tests, rule checks
npx playwright test e2e/          # browser smoke tests against the running stack
npx tsx scripts/env-check.ts      # which services are live, missing or failed (never prints a key)
```

Full steps, including the CREAO agents, Maincloud publishing, the Droid CLI and the demo laptop: [docs/SETUP.md](docs/SETUP.md).

## Known limits

- **CREAO, Droid and Maincloud have not run live here.**
  - The cloud session had no account-level CREAO key and no saved agents, so claims and patterns ran on fixtures.
  - Droid jobs need the laptop.
  - The SpacetimeDB numbers come from a local server.
  - Each one has an exact command in [docs/LIVE_CHECKLIST.md](docs/LIVE_CHECKLIST.md).
- **The video checks are internally consistent, not proof of authenticity.** A convincing fake video can fool a vision model. Vouch raises the cost and routes doubt to a person. Findings describe the footage, never the person; the reviewer never auto-denies.
- **The reviewer's transcript lane needs faster-whisper on the worker** (`pip install faster-whisper`). Without it, and for videos with no audio track, claims come from the written reason and the report says so.
- **The shopping score is illustrative, not a consumer report.** In production it would need consent, explanations and an appeal path. Appeals are out of scope.
- **The detector numbers come from a simulation we designed.**
- **The globe spreads agents up to 3° around their region's centre so they can be seen.** Positions are simulated home regions, not locations.
- **Frame-rate targets (45 fps on `/world`) are for the demo laptop.** The headless test browser renders in software.
