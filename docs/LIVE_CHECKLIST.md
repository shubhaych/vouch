# Live checklist

These checks could not run in the cloud session (no CREAO account key or agents, no Droid, no phone, no Maincloud login). Run them in this order in one sitting on the demo laptop. Paste each result into the PROGRESS.md line it names, then tick it.

Each command reads keys from the environment or the git-ignored `.env`. Never paste a key into a file, a commit or a log.

## 0. Environment

```bash
npm install
npx tsx scripts/env-check.ts            # writes docs/ENV_STATUS.md: live / missing / failed per service
```
Expect SpacetimeDB, CREAO, Factory Droid and ffmpeg all **live** before you continue.

## 1. SpacetimeDB on Maincloud (T0.3 on Maincloud, /system numbers)

```bash
spacetime login                          # browser sign-in; once per machine
STDB_SERVER=maincloud STDB_DB=vouch-world npm run stdb:publish
npm run stdb:generate                   # bindings come from module/ source, same for any server
# put the same STDB_URI / STDB_DB and NEXT_PUBLIC_STDB_* values in .env, then:
npm run worker                           # first connect claims the worker role and saves its token in worker/.keys/
npx tsx scripts/demo-reset.ts            # seed 11, 10,000 agents, tick running
npx tsx scripts/hello-stdb.ts 50         # paste "round trip over 50 pings: p50 .. p95 .." into README "Numbers"
```
Open `/system` in two tabs and check that both show the new pings. Add the Maincloud tick interval and ping numbers to the README with the date. `scripts/bench.ts` publishes throwaway databases, so run it against Maincloud only if the booth says that is fine.

## 2. CREAO agents (T0.5, then T2.5, T3.7, T5.3 live)

1. Create the three agents on agent.creao.ai ([CREAO.md](CREAO.md), "Setting up the three CREAO agents"). Use the exact names `Vouch Evidence Analyst`, `Vouch Refund Investigator` and `Vouch Pattern Analyst`.
2. Put an account key (`cr_sk_`) in `CREAO_API_KEY`.

```bash
curl -s https://developer.creao.ai/v1/agents -H "Authorization: Bearer $CREAO_API_KEY"   # lists the three agent_ids
CREAO_MODE=live npx tsx scripts/hello-creao.ts --record   # T0.5: one run per agent; saves real responses as fixtures
```
- **T0.5:** paste the three `agent_id`s into the README and CREAO.md tables. Copy one run's share link per agent from the CREAO interface.
- **T2.5 live:** restart the worker with `CREAO_MODE=live npm run worker`. Run `npx tsx scripts/claim-flow.ts qa/videos/G01-testsrc.mp4`, or use a phone video. On `/business`, both runs progress with "Open run" links, then the findings and the recommendation appear.
- **T3.7 live:** with the worker live, the next new pattern gets one Pattern Analyst run (at most 12 per simulation run). Check that `/world` shows its verdict and that the run link opens.
- **T5.3:** `curl -X POST localhost:8787/showcase/run -H 'content-type: application/json' -d "{\"code\":\"$DEMO_CONTROLLER_CODE\"}"` records a live showcase run to `worker/fixtures/showcase/recorded.json`. The home demo's CREAO steps then show "Replay of real run" with that run's link.
- **Kill switch:** on `/business`, switch CREAO off, file a claim, and see "Investigator offline". Switch it back on.

## 3. Factory Droid (T0.6, T4.3, T4.4 live)

```bash
# install the droid CLI (docs/SETUP.md) and set FACTORY_API_KEY
npx tsx scripts/hello-droid.ts           # T0.6: prints one sentence and "[result] success=true"
```
- **T4.3:** on `/lab`, ask Droid with one of the five preset goals. With the worker running, the job streams its plan, tool calls (each allowed or cancelled with the reason), the diff and the evaluator's scores live. The recording is saved to `worker/fixtures/lab/job-<n>.json`. Put that path in the README's "A lab job's recorded events".
- **T4.4 live:** press Promote on a job whose scores beat the live detector. `detectors/live/<id>.ts` gets the next version. At the next detector run (every 5 simulated days), pattern cards show the new version.

## 4. Phone and screens (T2.1, T1.5, videos)

- **T2.1:** set `NEXT_PUBLIC_WORKER_URL` to the tunnel URL. On `/shop`, buy, fast-forward and request a refund. Scan the QR with a phone; `/claim/<id>` opens and records with the rear camera.
- **T1.5:** on the demo laptop, `/world` keeps 45 fps or better. Check with Chrome DevTools, Rendering, Frame rendering stats.
- **Videos:** record V01–V07, V15 and V16 on a phone into `qa/videos/` (the list is in `qa/checklist.md`). Then rerun the video matrix in live mode and paste the table into QA_REPORT.md.

## 5. Fill in and ship

- Replace every `<fill in>` in README.md and docs/CREAO.md with real ids and links.
- `npm run check && npx playwright test e2e/` green. Then run `npx tsx scripts/demo-reset.ts` and the 4-minute demo script twice (T6.1).
