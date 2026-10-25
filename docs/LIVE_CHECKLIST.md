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
- **T2.5 live:** restart the worker with `CREAO_MODE=live npm run worker`. Run `npx tsx scripts/claim-flow.ts`, or use a phone video. On `/business`, both runs progress with "Open run" links, then the findings and the recommendation appear.
- **T3.7 live:** with the worker live, the next new pattern gets one Pattern Analyst run (at most 12 per simulation run). Check that `/world` shows its verdict and that the run link opens.
- **T5.3:** `curl -X POST localhost:8787/showcase/run -H 'content-type: application/json' -d "{\"code\":\"$DEMO_CONTROLLER_CODE\"}"` records a live showcase run to `worker/fixtures/showcase/recorded.json`. The home demo's CREAO steps then show "Replay of real run" with that run's link.
- **Kill switch:** on `/business`, switch CREAO off, file a claim, and see "Investigator offline". Switch it back on.

## 3. Factory Droid (T0.6, T4.3, T4.4 live)

```bash
# install the droid CLI (docs/SETUP.md) and set FACTORY_API_KEY
npx tsx scripts/hello-droid.ts           # T0.6: prints one sentence and "[result] success=true"
```
- **T4.3:** the lab page is hidden; verify a queued worker job records its plan, individually fenced tool calls, diff and evaluator scores in SpacetimeDB. The recording is saved to `worker/fixtures/lab/job-<n>.json`.
- **T4.4 live:** press Promote on a job whose scores beat the live detector. `detectors/live/<id>.ts` gets the next version. At the next detector run (every 5 simulated days), pattern cards show the new version.

## 3b. The video reviewer (Factory Droid + CREAO Refund Reviewer)

```bash
pip install faster-whisper                      # the transcript lane; without it the report says "no transcript"
# FACTORY_API_KEY set, local or Maincloud STDB in .env (the case folders are worker/cases/<claim>/, git-ignored)
npm run worker                                   # log says "video reviewer started (Droid live, 20 sessions/hour, proof by worker)"
npx tsx scripts/claim-flow.ts qa/videos/S02-fresh.mp4   # or a phone video; prints the tier's proposal when the report row lands
```
- On `/claim/<id>` the ten steps tick with Droid's live notes ("Checking claim 1 of 2 at 00:04"); on `/business` the report panel shows the tier, the reel, the findings with clips, the audit, the score and "How this was investigated".
- `worker/cases/<claim>/droid.log` holds every message, tool call and fence decision; `report.md` is the same report for people.
- **Reviewer live:** create `Vouch Refund Reviewer` and `Vouch Customer Liaison` on agent.creao.ai ([CREAO.md](CREAO.md)), restart with `CREAO_MODE=live`; the report's Reviewer block turns from Fixture to Live with the run id.
- Done so far on the laptop (2026-10-24): fixture-mode pipeline end to end on S01 (lanes only, T4 proposal in 2 s); live Droid sessions on S02–S05 (claims extraction, Case Analyst with the fence and nudges, MCP tools, findings; on S05 → C-6 the Report Auditor verified every hash and clip and passed all three findings, 150 s end to end with 3 sessions). The QA videos have no audio and show synthetic footage, so every live run ended in T4 "more evidence". Still to do: a run with faster-whisper installed, a real phone video, the Reviewer live.

## 4. Phone and screens (T2.1, T1.5, videos)

- **T2.1:** the phone needs HTTPS for the camera and must reach both the web app and the worker. With no account: `brew install cloudflared`, then in two terminals `cloudflared tunnel --url http://localhost:3000` and `cloudflared tunnel --url http://localhost:8787`; each prints an `https://<words>.trycloudflare.com` URL. Start the web app and the worker with `NEXT_PUBLIC_WORKER_URL=<worker tunnel URL>` (the worker reuses it for the proof-clip links). Open `/shop` on the laptop **through the web tunnel URL** (the QR encodes the page's own origin), buy, fast-forward and request a refund. Scan the QR with the phone; `/claim/<id>` opens and records with the rear camera. The database must be reachable from the phone too: Maincloud is, a local server is not.
- **T1.5:** on the demo laptop, `/world` keeps 45 fps or better. Check with Chrome DevTools, Rendering, Frame rendering stats.
- **Videos:** record V01–V07, V15 and V16 on a phone into `qa/videos/` (the list is in `qa/checklist.md`). Then rerun the video matrix in live mode and paste the table into QA_REPORT.md.

- UNVERIFIED-LIVE: factory: extra-clip flow on a phone (no finger challenge → "Add more evidence" → second clip joined on the business timeline): `npm run worker`

## 5. Fill in and ship

- Replace every `<fill in>` in README.md and docs/CREAO.md with real ids and links.
- `npm run check && npx playwright test e2e/` green. Then run `npx tsx scripts/demo-reset.ts` and the 4-minute demo script twice (T6.1).
