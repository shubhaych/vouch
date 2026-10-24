# QA checklist (Loop 2)

Each acceptance test from the spec (Section 14) is written as a step a user takes ("I do X and see Y"), with how it was run. Mode: `CREAO_MODE=fixture`, local SpacetimeDB, started from `npx tsx scripts/demo-reset.ts` with the sim running.

Run by:
- `qa/matrix.ts`: the video matrix, through the real reducers and the upload route.
- `qa/personas.spec.ts`: personas in the browser.
- `e2e/smoke.spec.ts`
- The unit tests

Results are in `QA_REPORT.md`.

## G0 Foundations
- [ ] T0.1 I run `npm run check` and `npm run lint`: both pass.
- [ ] T0.2 I open `web/DESIGN.md` and `e2e/constructa-ref.png`: Constructa's tokens, section order and background are recorded.
- [ ] T0.3 I open `/world` in two tabs and join as a shopper in a third: both tabs show "A-9000xx joined" (e2e T0.3).
- [ ] T0.4 I read `sim_run.day` twice a minute apart: it advanced.
- [ ] T0.5 / T0.6 Live CREAO and Droid hello scripts: UNVERIFIED-LIVE (docs/LIVE_CHECKLIST.md).

## G1 The economy
- [ ] T1.1–T1.4 Module tests pass (seeding, determinism, credit causes, region totals).
- [ ] T1.5 I open `/world`: "10,0xx agents", businesses visible, arcs appear, the honesty line reads "Simulated agents. Vouch does not track real locations."
- [ ] T1.6 I hover the monitor (it pauses) and click a Purchase line: that agent's panel opens.
- [ ] T1.7 I open `/system`: row counts, agent-steps/s, events/s and ping p50/p95, each with a Live badge.

## G2 One live claim
- [ ] T2.1 On `/shop` I buy, fast-forward and request a refund; a QR and "use this device" appear; the claim page opens at 390 px (P1).
- [ ] T2.2 I upload with a wrong nonce (403), a 2 s clip (422 "at least 4 seconds"), and to a claim older than 10 minutes (410) (NONCE, V12, V14).
- [ ] T2.3 I upload a 12 s clip: "Frames extracted, 9 frames"; the first and last second are included.
- [ ] T2.4 A second account uploads the same video, and then a re-encoded copy: "Matches frames from claim C-…" (V08, V09).
- [ ] T2.5 On `/business` I open the claim: the Evidence Analyst then the Investigator run (Fixture badge), with findings, frames and a recommendation with cited reasons.
- [ ] T2.6 Unparseable agent output fails closed (worker unit test).
- [ ] T2.7 I switch CREAO off on `/business` and file a claim: "Investigator offline", no run starts, accept is refused, more evidence works (V15).
- [ ] T2.8 I accept: decision, journal entry, credit 600 → 612; the phone shows "Refund approved" and the score tween (V02, e2e).
- [ ] T2.9 The worker (proposer) cannot decide; a shopper cannot decide; above $500 a business accept waits for the controller (P6, V16).

## G3 Vouch World
- [ ] T3.1 I click an agent: tiles, chips, credit chart, timeline.
- [ ] T3.2 I click a dot on the credit chart: the purchase or refund that caused it opens (cause card).
- [ ] T3.3 Patterns appear on the rail every few days with `why` lines.
- [ ] T3.4 / T3.5 Region shuffle test passes; `npx tsx detectors/eval.ts --live --seed 23` prints precision, recall and honest flagged.
- [ ] T3.6 I switch to Replay and click a pattern: the camera fits, the rest dims, the scrubber plays with the list.
- [ ] T3.7 A flagged pattern gets one Pattern Analyst review; confirm applies −120 to core agents only (module test; fixture review on the rail).
- [ ] T3.8 I switch to Observatory and click each of the seven metrics: the globe recolours; I click a region: its panel opens with `region_stat` numbers.
- [ ] T3.9 No public table exposes an agent's kind (`agent_truth` is private).

## G4 Lab
- [ ] T4.1 Each trigger enqueues a job (module test); on `/lab` I ask Droid with a preset and see the job queued.
- [ ] T4.2 Fence tests pass.
- [ ] T4.3 / T4.4 Live Droid job and promotion: UNVERIFIED-LIVE.

## G5 Home and credentials
- [ ] T5.1 / T5.2 I open `/`: Constructa's section order, the moving background, Live counters ticking.
- [ ] T5.3 The live demo panel loops through its steps (fixture/replay until a real run is recorded).
- [ ] T5.4 On `/business` I verify a credential (5 steps pass), Tamper (fails step 4), Revoke (fails step 3) (P6).
- [ ] T5.5 A vouched shopper's claim cites `credential:B-019` (P2 via the showcase run, and the unit test).

## G6 Ship
- [ ] T6.4 Secret scan of the repo and the client bundle; the fixture-mode build refuses.

## Unhappy paths
- [ ] Double-click Pay creates one order.
- [ ] A wrong seat code shows a clear message.
- [ ] Refreshing the claim page mid-claim keeps its state; the same claim link open in two tabs shows the same state.
- [ ] Every page at 390 px has no horizontal scroll.
- [ ] The worker restarted mid-claim: the claim still completes.
- [ ] The kill switch flipped while a run is in flight: the claim goes offline, with no proposal.
- [ ] Slow network (Playwright throttling) on `/claim`: the upload shows progress and completes.
