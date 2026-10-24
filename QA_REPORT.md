# QA report, Loop 2, 2026-10-24 13:15 UTC

Mode: **Fixture** (`CREAO_MODE=fixture`; no CREAO agents or Droid in this session), local SpacetimeDB 2.13.0, started from `npx tsx scripts/demo-reset.ts` (seed 11, 10,000 agents, sim running). Every result below is a Fixture result. The live passes wait for keys: [docs/LIVE_CHECKLIST.md](docs/LIVE_CHECKLIST.md).

How it was run:
- `npx tsx qa/matrix.ts --p3 qa/agent-<id>.json`: the video matrix through the real reducers and the upload route. Output: `qa/results/matrix-fixture.json`.
- `npx playwright test qa/personas.spec.ts qa/observatory.spec.ts`: the personas in the browser, with screenshots in `qa/shots/`.
- `npx tsx qa/unhappy.ts`: the kill switch mid-run and a worker restart. Output: `qa/results/unhappy.json`.
- `npx playwright test e2e/`: the smoke tests (4/4 passed at 12:46).

The step list is in [qa/checklist.md](qa/checklist.md).

## Summary: video matrix 10/11 runnable cases as expected (V10 failed), 6 blocked on human videos (V01, V03–V07); personas and other checks 6 passed, 9 failed, 1 not testable in fixture mode

- **Issues:** 1 × P0, 6 × P1, 2 × P2, 3 × P3.
- **Human videos:** V01, V03–V07 need real phone recordings and stay **BLOCKED**. V02, V15 and V16 were run with generated stand-in clips: the flow is checked, but not what a vision model makes of the content.
- **Not testable in fixture mode:** the kill switch flipped mid-run. Fixture runs finish in under a second, so the switch cannot land mid-run; see the note under QA-006. It needs a live run.

## Video matrix

| ID | Persona | Video | Expected | Actual | Match | Run links | Time to rec. |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V01 | P2 | real damaged item | accept, full amount | BLOCKED: needs a phone recording | – | – | – |
| V02 | P1 | `G01-testsrc` (generated stand-in) | accept or smaller; never decline | accept $249.00, original payment, conf 0.78; business accepted; credit 600 → 612; journal #9 | yes (but see QA-003: this clip is a still image) | Fixture | 3.6 s |
| V03–V07 | P1/P3/P4 | real phone videos (intact item, wrong fingers, wrong item, screen recapture, blurry) | see spec | BLOCKED: needs phone recordings | – | – | – |
| V08 | P4 | copy of V02 on a new account | reuse flag naming the first claim | reuse → C-24 (V02's claim), distance 0; more_evidence | yes | Fixture | 4.1 s |
| V09 | P4 | V02 re-encoded 854 px, crf 32 | reuse still caught | reuse → C-24 and C-25, distance 0; more_evidence | yes | Fixture | 2.5 s |
| V10 | P4 | slideshow of a stock image (zoompan) | reuse against listing images, or more evidence | no flag; **accept $249.00**, conf 0.78 | **no** (QA-003) | Fixture | 2.8 s |
| V11 | P1 | black, 8 s | unable to verify; more evidence | blank_frames 9; unable_to_verify; more_evidence | yes | Fixture | 3.7 s |
| V12 | P1 | 2 s clip | rejected with a clear message | 422 "That video is 2.1 seconds. Please record at least 4 seconds, ending with the finger challenge." | yes | – | – |
| V13 | P1 | truncated file | rejected, no crash | 422 "We could not read that video. Please record it again in the app."; worker healthy | yes | – | – |
| V14 | P1 | valid clip 11 min after the claim | rejected as stale | 410 "This claim link expired (more than 10 minutes old)…" | yes | – | – |
| V15 | stand-in | kill switch off | "Investigator offline"; no run; only more evidence | offline; 0 runs; accept refused (message lost, QA-001); more evidence ok | yes | – | – |
| V16 | stand-in | $649 order | goes to the controller | business accept → refund `awaiting_controller`; controller accept → accepted; journal #10 | yes (the runner checked for the wrong status name, `sent_to_controller`; the product behaved as specified) | Fixture | 2.5 s |
| NONCE | P4 | wrong nonce | rejected | 403 "This upload link is not valid for that claim (wrong nonce)." | yes | – | – |

## Personas and other checks

| Check | Result |
| --- | --- |
| P1 home `/` (1440 and 390 px): counters Live, live demo, no sideways scroll | pass (`qa/shots/P1-home-*.png`) |
| P1 `/shop` → claim: double-click Pay makes one order; a 2 s clip shows the 4-second message; refresh mid-claim keeps state; a second tab on the same claim shows the same state | pass (`qa/shots/P1-claim-*.png`) |
| P2 vouched shopper (showcase A-00421 at B-002) | **fail**: the credential check failed at step 3 (expired), so it was not cited (QA-002). The citation logic itself is unit tested (T5.5). |
| P3 repeat claimer (`make-agent --purchases 10 --refunds 6`) | no automatic decline (pass), but the reason says the refund history is "in line with typical shoppers" (QA-004) |
| P4 fraudster (two fresh accounts, reused and re-encoded video, stock slideshow) | reuse caught; slideshow accepted (QA-003) |
| P5 business: wrong seat code | **fail**: toast reads "takeBusinessSeat: The instance encountered a fatal error." (QA-001) |
| P5 business: queue, investigation, kill switch off and on, 390 px | pass on rerun, apart from the toast text (`qa/shots/P5-*.png`). The queue shows C-40 stuck "Investigating" (QA-006). |
| P6 controller / proposer: the worker identity and a shopper cannot decide | pass (refused), but both messages are lost (QA-001) |
| P6 credential Verify / Tamper / Revoke on `/business` | **fail**: the first Verify already fails at step 3, because the showcase credential had expired (QA-002) |
| P7 globe: four layers, monitor → agent panel, credit dot → cause card (T3.2), Replay (pattern → panel, scrubber, play, events) | pass (`qa/shots/P7-*.png`) |
| P7 Observatory: seven metrics, region click | **fail**: the second metric click timed out after 60 s (QA-008) |
| P8 `/lab` ask Droid; `/system` bench table | **fail**: the preset menu cannot be clicked (QA-007); the `/system` bench table was not reached |
| Every page at 390 px | **fail**: `/system` is 533 px wide (QA-009) |
| Worker restarted while a claim is investigating | **fail**: the claim stays `investigating` forever (QA-006) |
| Kill switch flipped mid-run | not testable in fixture mode (runs finish in < 1 s); the orchestrator checks the switch before each run and before the proposal (`worker/src/orchestrator.ts` lines 100, 138, 172) |
| Secret scan (repo and `web/.next/static`), fixture build refuses | pass |

## Issues

### QA-002 [P0] The showcase credential expires about 6 minutes after a reset, and the home demo's credential step then fails
- Persona: P2, P6, home live demo
- Steps:
  1. `npx tsx scripts/demo-reset.ts`
  2. Wait 6 minutes (180 simulated days at 2 s per day).
  3. `curl -X POST localhost:8787/showcase/run -d '{"code":"vouch-controller"}' -H 'content-type: application/json'`, or open `/business` and press Verify.
- Expected: A-00421's credential from B-019 verifies in five steps and the Investigator cites `credential:B-019`.
- Actual: "Failed at step 3" (expired: VC-3876 issued day 123, expires day 303, the sim is past day 800). The showcase claim C-35 has `credential.verified=false, failed_step=3`, so there is no citation.
- Evidence: `spacetime sql vouch "SELECT * FROM credential" -s dev3011`; `qa/results-personas.log` (P6).
- Suspected area (do not fix): `worker/src/credentials.ts` `VALIDITY_DAYS = 180`; `worker/src/showcase.ts` re-issues only when no un-revoked credential exists, and ignores expiry.
- **Loop 3: FIXED** in `c829054`.
  - Business A now renews A-00421's credential 30 days before it expires (checked every 10 simulated days), and the showcase calls `ensureFresh` before each run.
  - While verifying, a second cause showed up: each showcase run adds a refund to A-00421's record. After the second run the ratio is 4/40 = 0.10, so a renewed credential said "medium" and failed Business B's policy at step 5. The low band is now < 15%, a realistic retail return rate.
  - Regression: `worker/test/credentials.test.ts` ("QA-002 …", two tests).
  - Scenario: after the restart, VC-28c9 was issued at day 1050 (valid to 1230). The Loop 3 rerun is below.

### QA-001 [P1] Every refused reducer call reaches the user as "The instance encountered a fatal error."
- Persona: P5, P6, V15
- Steps: on `/business`, enter a wrong seat code. Or, with the kill switch off, accept a claim that has no recommendation.
- Expected: the module's message, for example "wrong seat code" or "Investigator offline: request more evidence".
- Actual: "takeBusinessSeat: The instance encountered a fatal error." The module log shows `PANIC: decide src/desk.ts:64: Uncaught Error: Investigator offline: request more evidence`.
- Evidence: `spacetime logs vouch -s dev3011 | grep PANIC`; `qa/shots/P5-wrong-code.png`.
- Suspected area (do not fix): `module/src/*.ts` throw plain `Error`. SpacetimeDB 2.13 treats only `SenderError` (from `spacetimedb/server`) as a graceful, user-facing failure.
- **Loop 3: FIXED** in `c829054`.
  - Every refusal in a reducer file now throws `SenderError`. Engine refusals (sim.ts stays free of spacetimedb imports) are converted by `asSenderError` in `module/src/ctx.ts`.
  - Regression: `module/src/reducers.test.ts` "QA-001 …".
  - Scenario: V15's accept now answers "Investigator offline: request more evidence"; P6 answers "requires role: business or controller".

### QA-003 [P1] A slideshow of one still image is recommended for a full refund (V10)
- Persona: P4
- Steps: `npx tsx qa/matrix.ts --only V10`
- Expected: more evidence (or a reuse flag).
- Actual: no deterministic flag; Evidence "consistent"; Investigator accept $249.00.
- Measured frame-to-frame dHash distance (median):
  - V10 slideshow: 2.
  - `G01-testsrc`: 0. The V02 stand-in is also effectively a still image, and is also accepted.
  - A moving clip (`S01`): 16.
- Evidence: `qa/results/matrix-fixture.json` (V10).
- Suspected area (do not fix): `worker/src/video.ts` has no "little motion" check; `worker/src/fixtures.ts` only reacts to blank frames, reuse and recapture.
- **Loop 3: FIXED** in `299bda3`.
  - New deterministic checks `frame_motion` (median dHash change between consecutive non-blank frames) and `still_image` (≤ 3). Both are sent to both agents.
  - The fixture Investigator answers more evidence ("The video barely changes from frame to frame…"), never decline, and `/business` shows a "Little motion" chip.
  - The V02/V08/V09 stand-ins moved to a moving clip, and `claim-flow.ts` now records a fresh moving clip.
  - Regression: `worker/test/video.test.ts` "QA-003 …" and the still-image rule in `worker/test/creao.test.ts`.
  - Scenario: V10 → more_evidence; V02 → accept.

### QA-004 [P1] A repeat claimer's recommendation says their refund history is "in line with typical shoppers"
- Persona: P3
- Steps:
  1. `npx tsx scripts/make-agent.ts --purchases 10 --refunds 6`
  2. Upload a clean video to its first claim.
- Expected: more scrutiny (history weighed as context, cited honestly). Never an automatic decline.
- Actual: accept, conf 0.78. The reason `history:refund_ratio_90d` reads "The customer's refund history is in line with typical shoppers." This is false: 6 refund requests on 10 purchases.
- Evidence: `qa/results/matrix-fixture.json` (P3).
- Suspected area (do not fix): `worker/fixtures/refund_investigator.accept.json` uses a fixed history sentence; `worker/src/fixtures.ts` ignores `history`.
- **Loop 3: FIXED** in `63818af`.
  - The history reason now states the shopper's numbers, e.g. "Refunds were requested on 6 of the last 10 purchases (60% in 90 days), well above typical shoppers; weighed as context, not proof…".
  - A ratio ≥ 40% with 3 or more requests lowers confidence to 0.55. The action stays accept when the video is consistent, so never an automatic decline.
  - Regression: `worker/test/creao.test.ts` "QA-004 …".
  - Scenario: P3 rerun as above.

### QA-005 [P1] Scheduled lab jobs fill `/lab`, and with a Droid key they would use up the 6-job cap within minutes of a reset
- Persona: P8
- Steps: run the sim for 10 minutes, then `spacetime sql vouch "SELECT COUNT(*) FROM lab_job" -s dev3011`.
- Expected: at most a few jobs per simulation run, with room left for the user, event and agent triggers.
- Actual:
  - 55 jobs, all "Droid unavailable here; nothing was run."
  - One schedule job is queued every 30 simulated days, which is one a minute.
  - Jobs that ran in replay or no-key mode do not count toward the cap.
  - With a key, the first 6 schedule jobs would take the whole cap about 6 minutes after a reset. The demo's user or event job would then be refused ("this run already used its 6 jobs"), after spending credits on drift reviews.
- Evidence: `qa/results-personas.log`; `module/src/economy.ts` lines 78–84; `module/src/lab.ts` `enqueueLabJob`.
- Suspected area (do not fix): the schedule trigger frequency and the cap counting in `module/src/lab.ts`.
- **Loop 3: FIXED** in `a4cafad`.
  - A run is now counted from the last (re)seed, using a `lab_run_first_job` counter. The seed alone could not tell demo resets apart, so the old cap would have carried over between demos.
  - Every job counts toward the 6, whatever its mode.
  - The schedule may queue only one job per run.
  - Regression: `module/src/reducers.test.ts` "QA-005 …".

### QA-006 [P1] A claim being investigated when the worker restarts is never resumed
- Persona: P5 (unhappy path)
- Steps: `npx tsx qa/unhappy.ts`. It stops the worker, leaves a claim in the state a crash mid-run leaves (`investigating`, no proposal), then starts the worker.
- Expected: the claim is picked up again and gets a recommendation.
- Actual: "C-40 after restart: status investigating; proposal none after 45 s". Live CREAO runs take minutes, so any worker restart during a live run strands the claim.
- Evidence: `qa/results/unhappy.json`.
- Suspected area (do not fix): `worker/src/orchestrator.ts` `onClaim` only starts claims in `frames_ready`.
- Note: the kill switch flipped mid-run could not be tested in fixture mode, because the whole flow completes in under a second. By reading the code, the switch is checked before each run and before the proposal.
- **Loop 3: FIXED** in `a4cafad`.
  - The start-up scan now also resumes claims left `investigating` (`claimNeedsWork`). `runClaim` reuses an Evidence Analyst result that was already recorded.
  - Regression: `worker/test/orchestrator.test.ts` "QA-006 …".
  - Scenario: `qa/unhappy.ts` → "C-44 after restart: status recommended".

### QA-007 [P1] On `/lab`, the "Ask Droid" preset menu opens underneath the scorecard panel, so no preset can be clicked
- Persona: P8
- Steps: `/lab` → click "Ask Droid" → click any preset.
- Expected: the job is queued (the user trigger, T4.1).
- Actual: the click never lands. Playwright reports `<div class="panel-title mb-2">Scorecard on a fresh world</div> … intercepts pointer events` for 120 s.
- Evidence: `qa/results-personas-2.log` (P8).
- Suspected area (do not fix): `web/components/lab/lab-view.tsx` `AskDroid`. The `z-20` dropdown sits inside a `.glass` panel, which makes its own stacking context, so the later grid paints above it.
- **Loop 3: FIXED** in `a4cafad`.
  - The `<details>` panel gets `z-30`, so it stacks above the job grid.
  - Regression: `e2e/regressions/QA-007.spec.ts` (trial click on a preset at 1440 and 390 px).

### QA-008 [P1] Switching Observatory metrics stalls the page in the headless browser
- Persona: P7
- Steps: `/world` → Observatory → click "Refund requests" after "Shopping activity".
- Expected: the globe recolours within a second or two.
- Actual: the click waited 60 s and timed out. Timing per metric is in `qa/results/observatory-timing.json`.
- Evidence: `test-results/qa-personas-P7-…/trace.zip`, `qa/results-observatory.log`.
- Suspected area (do not fix): `web/components/world/observatory.tsx` / `globe.tsx`, which rebuild hexbin geometry for every metric. Headless Chromium renders WebGL in software, so this may be much faster on the demo laptop. It still needs checking there.
- **Severity raised to P1.** `qa/observatory.spec.ts` measured 12 to 77 s per metric switch, with long tasks filling the whole time. The page's main thread was saturated, not just slow to draw.
- **Loop 3: FIXED** in `2499704`.
  - Root cause: the inline `hexAltitude`/`hexTopColor` accessors changed on every render, and the globe re-renders every 400 ms for the feed, so react-globe.gl rebuilt every hex mesh, with a 600 ms transition.
  - Fix: stable accessors, `hexBinMerge` with no transition, and re-binning only on a metric switch or every 10 s. Merged hexes cannot be clicked, so a globe click picks the region.
  - Regression: `e2e/regressions/QA-008.spec.ts`. It now takes 1.2–4.9 s per switch, headless, and the region panel opens.

### QA-009 [P2] `/system` scrolls sideways at 390 px
- Persona: P8, quality bar
- Steps: open `/system` at 390 × 844.
- Expected: no horizontal scroll.
- Actual: `scrollWidth` 533.
- Evidence: `qa/shots/W390-system.png`.
- Suspected area (do not fix): `web/components/system/system-view.tsx`, the bench and row-count tables (long machine string, no `overflow-x-auto`).
- **Loop 3: FIXED** in `a4cafad`.
  - `grid-cols-1` on the mobile grids, and the bench table scrolls inside its panel.
  - Regression: `e2e/regressions/QA-009.spec.ts`.

### QA-010 [P3] The showcase's credential reason says "10 or more purchases" while the credential discloses "25 or more"
- Suspected area: `worker/src/showcase.ts` `replayInvestigators` hard-codes the sentence.
- **Loop 3: FIXED** in `63818af`: the reason now repeats the disclosed claims.

### QA-011 [P3] Truncated labels at 390 px
- The home counter "INVESTIGAT…", and the `/system` tiles "ROWS (COUNTE…" and "AGENT-STEPS / …".
- Evidence: `qa/shots/P1-home-390.png`, `qa/shots/W390-system.png`.
- **Loop 3: FIXED** in the Loop 3 rerun commit.
  - `Stat` labels wrap instead of truncating.
  - Checked by the 390 px persona screenshots (`qa/shots/P1-home-390.png`, `qa/shots/W390-system.png`).

### QA-012 [P3] The "Ask Droid" preset menu is 26 rem wide
- It overflows a 390 px screen when open.
- Suspected area: `web/components/lab/lab-view.tsx` `AskDroid` (same component as QA-007).
- **Loop 3: FIXED** in `a4cafad`.
  - The menu is `min(26rem, 100vw − 2rem)` wide and left-aligned on phones.
  - Regression: `e2e/regressions/QA-007.spec.ts`.
