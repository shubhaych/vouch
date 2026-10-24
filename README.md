# Vouch World

Refund fraud costs businesses money, and the usual fraud controls punish honest shoppers. Vouch handles both. Ten thousand simulated shoppers buy and return goods inside a SpacetimeDB database. Three saved CREAO agents investigate claims and confirm fraud patterns. A Factory Droid writes and tests new fraud detectors inside a fenced lab. A real person can join from a phone, buy, record a damaged item and watch the refund get decided live.

Started during Cal Hacks 13.0. First commit: `cc89a17`, 2026-10-23 20:57:05 -0700.

| Page | What it shows |
| --- | --- |
| `/` | Home page in Constructa's format. A live demo panel runs a purchase through to a verified refund and a credit change. |
| `/world` | The globe: 10,000 agents, 60 businesses, purchase and refund arcs, the event monitor, agent panels, the Fraud Replay and the Observatory. |
| `/shop`, `/claim/[id]` | The shopper's phone flow: join, buy, fast-forward, request a refund, record a video holding up the requested number of fingers. |
| `/business` | The refunds desk: the CREAO org chart with the kill switch, frames and checks, the five-step credential check, the recommendation, the decision. |
| `/lab` | The Droid Detector Lab: queued jobs, the plan, tool calls, the diff, scores on a fresh world, promote or reject. |
| `/system` | Live row counts, agent-steps per second, events per second, ping p50/p95, and benchmark results. |

Every number on screen carries a badge: **Live** means computed now from SpacetimeDB rows, **Simulated** means it comes from the agent simulation, **Fixture** means recorded test data, and **Replay** means the replay of a real run. The agents are synthetic: "Simulated agents. Vouch does not track real locations."

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

## Factory: where Droid is used

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
| Video frames, hashes, freshness, blank-frame and reuse checks | Live (ffmpeg and dHash in the worker) |
| CREAO findings, recommendations and pattern reviews | Fixture in this build (`CREAO_MODE=fixture`); live runs wait for the agents (see the checklist) |
| Detector scores | Measured on fresh simulated worlds against the simulation's ground truth |
| Droid jobs | Not run here (no Droid in the cloud session); the fence and the pipeline are unit tested |
| Credentials | Real Ed25519 signatures and salted digests; simulated issuers; registry in SpacetimeDB, not on a public chain |

Line-by-line detail, with the command that checks each line: [docs/REAL_VS_SIMULATED.md](docs/REAL_VS_SIMULATED.md). Facts checked against the real libraries and services: [docs/VERIFIED.md](docs/VERIFIED.md).

## Setup

```bash
npm install
cp .env.example .env              # fill in what you have; every key is optional for local fixture mode
npm run stdb:start                # local SpacetimeDB on :3011 (or use Maincloud, docs/SETUP.md)
npm run stdb:publish && npm run stdb:generate
npm run worker                    # Fastify worker on :8787: orchestrator, video, detectors, poster, lab
npm run dev                       # web on http://localhost:3000
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
- **The video checks are internally consistent, not proof of authenticity.** A convincing fake video can fool a vision model. Vouch raises the cost and routes doubt to a person.
- **The shopping score is illustrative, not a consumer report.** In production it would need consent, explanations and an appeal path. Appeals are out of scope.
- **The detector numbers come from a simulation we designed.**
- **The globe spreads agents up to 3° around their region's centre so they can be seen.** Positions are simulated home regions, not locations.
- **Frame-rate targets (45 fps on `/world`) are for the demo laptop.** The headless test browser renders in software.
