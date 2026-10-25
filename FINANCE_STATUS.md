# Refund Finance Desk status

Updated: 2026-10-24 (local simulation and shop walkthrough)

## Current gate

F3 is still in progress. F0–F2 (ledger, reconciliation, close snapshots) and the CREAO mock/live adapter remain. The exception investigator boundary in `worker/src/finance/droid-investigator.ts` is schema-checked and mock/replay-capable, but it is not yet connected to persisted exception clusters. The local walkthrough now exposes all 100 finance companies and 400 products on `/shop`, and the Desk has controller-gated finance speed and scenario controls.

## What is verified

- Module typecheck passes.
- Module tests pass: 68 tests, including balanced Maya workflow, ledger control refusals, deterministic portfolio simulation, and exposure tests.
- Worker typecheck passes.
- Worker finance unit tests pass: reconciliation (including cause bridge), playbooks/verifier/driver board (6 new tests), CREAO mock schemas.
- Verifier accepts a tied-out playbook proposal and rejects a deliberately wrong explanation (unbalanced entry, bad parts sum, unknown cited id).
- Close path: reconcile → clusterExceptions → verifyClusters → causeBridge → buildDriverBoard → `financeRecordClose` with funnel counts (`closedByPlaybook`, `toInvestigator`, `toController`).
- Desk Close panel shows funnel counters, cause bridge, exception clusters and playbook status; Driver board panel lists ranked actions with owners.
- Close/Advisor CREAO inputs now receive the code-built driver actions (Advisor remains mock until live agents exist).
- The shop directory subscribes to `finance_company`, `finance_product` and `finance_company_state` in SpacetimeDB; each company links to its own Desk selection.
- Finance simulation controls use worker routes protected by the configured controller code; supported speeds are 1x, 5x and Turbo, and scenario chips inject ring, sale-day and defect-batch events.
- Root and workspace typechecks pass. The optimized web build passes with `npm run build -w web -- --webpack`.
- Finance agent status: **not created** for all five seats. `npm run creao:check` reports each per-agent App ID and API key as set or missing; app-scoped credentials are verified by the first live run. Mock outputs are labeled Simulated and are not live acceptance evidence.
- WAITING FOR HUMAN: create Finance Impact Analyst in CREAO and set `CREAO_FINANCE_IMPACT_ANALYST_APP_ID` + `CREAO_FINANCE_IMPACT_ANALYST_API_KEY`.
- WAITING FOR HUMAN: create Finance Impact Reviewer in CREAO and set `CREAO_FINANCE_IMPACT_REVIEWER_APP_ID` + `CREAO_FINANCE_IMPACT_REVIEWER_API_KEY`.
- WAITING FOR HUMAN: create Close Controller in CREAO and set `CREAO_FINANCE_CLOSE_CONTROLLER_APP_ID` + `CREAO_FINANCE_CLOSE_CONTROLLER_API_KEY`.
- WAITING FOR HUMAN: create Forecast and Drivers Advisor in CREAO and set `CREAO_FINANCE_ADVISOR_APP_ID` + `CREAO_FINANCE_ADVISOR_API_KEY`.
- WAITING FOR HUMAN: create Exposure Guardian in CREAO and set `CREAO_FINANCE_GUARDIAN_APP_ID` + `CREAO_FINANCE_GUARDIAN_API_KEY`.

## Still stubbed or incomplete

- F1/F2: cause bridge now foots from exception causes + residual; full close against a live SpacetimeDB server and controller lock workflow still need an integration pass. Bulk-book accrual import into SpacetimeDB is not done.
- F3 remaining: wire investigator results into persisted cluster updates, document intake, AskUser / rewind UI. Live CREAO runs remain blocked on human-created agents.
- F4: Case screen depth (sources side-by-side, journal lines, both judgments), controller queue actions, audit log detail, free-text scenario parsing, scorer (`score.ts` / `FINANCE_SCORE.md`), red team, Playwright desk + main-path flag off/on. The scenario chips are available; the free-text scenario path remains unbuilt.
- No live SpacetimeDB publish was made as part of this step.
- Turbopack production build is blocked in this environment by a helper-process port bind (`Operation not permitted`); the equivalent webpack production build succeeds. `next dev` remains the recommended local preview command.

## Next gate's first step

Wire the Droid Exception Investigator into unresolved close clusters with persisted structured evidence and Verifier results. Then continue the Case/Controller screens and the score/red-team proof path.
