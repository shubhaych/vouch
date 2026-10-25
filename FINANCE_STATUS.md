# Refund Finance Desk status

Updated: 2026-10-24

## Current gate

F3 is in progress. F0 ledger/control logic and the seeded 100-company portfolio were added in commit `37c5455`; F1 reconciliation and F2 close snapshots are in commits `4d2224f` and `785bdc5`. The five finance CREAO definitions, schema-checked mock/live/replay adapter, account agent check, claim/close run persistence and Desk proof panel are implemented locally. Finance impact runs start only for a final, audited claim decision and are detached from the request; close judgments likewise start after the close snapshot is recorded. These changes have not yet been committed.

## What is verified

- Module typecheck passes.
- Module tests pass: 68 tests, including balanced Maya workflow, ledger control refusals, deterministic portfolio simulation, and exposure tests.
- Worker typecheck passes.
- Worker reconciliation unit tests pass against an in-memory DuckDB fixture.
- Worker close adapter uses a separate `reconciler` identity; the optional worker startup bootstraps accountant, reconciler and analyst seats, prepares the book if missing and leaves the simulation paused. `POST /finance/close/:period` requires the configured controller code and records the source totals, bridge and exception clusters.
- The seeded generator produced 1,000,000 orders, 76,116 decisions, 101,041 processor rows, 100,741 bank rows, 39,873 warehouse rows, 201,722 ledger rows and 1,500 planted cases on this machine. A 2-run seed-17 test compared the full planted answer key and passed in about 2.3 seconds; timings vary by machine.
- `FINANCE_DESK=1` asks the worker to seed the portfolio catalog/rows on startup. It remains paused until a controller starts it from the Desk. The main refund path is unchanged when the flag is off.
- Finance agent status: **not created** for Finance Impact Analyst, Finance Impact Reviewer, Close Controller, Forecast and Drivers Advisor, and Exposure Guardian. `npm run creao:check` ran with no account key and therefore reported all five as not checked. No live IDs, links or credentials have been supplied.
- The CREAO worker startup check and Desk status endpoint report exact agent ID/name matches when an account key is configured. The Desk triggers the Impact Analyst, then the separate Impact Reviewer, for final audited claims; period close triggers the Close Controller and Drivers Advisor. The Exposure Guardian is queued on six-sim-hour portfolio checks, with a two-run concurrency cap. Reducers enforce allowed rungs and expiry; non-pause changes are applied by code, while Pause creates a controller confirmation item. Mock outputs are labeled Simulated and are not live acceptance evidence.
- Live `finance_agent_run` rows are recorded as soon as CREAO returns a run ID; worker startup resumes polling unfinished IDs after a restart. Outputs and inputs are retained for the Desk audit view.
- WAITING FOR HUMAN: create Finance Impact Analyst in CREAO and set `CREAO_AGENT_IMPACT_ANALYST`.
- WAITING FOR HUMAN: create Finance Impact Reviewer in CREAO and set `CREAO_AGENT_IMPACT_REVIEWER`.
- WAITING FOR HUMAN: create Close Controller in CREAO and set `CREAO_AGENT_CLOSE_CONTROLLER`.
- WAITING FOR HUMAN: create Forecast and Drivers Advisor in CREAO and set `CREAO_AGENT_ADVISOR`.
- WAITING FOR HUMAN: create Exposure Guardian in CREAO and set `CREAO_AGENT_GUARDIAN`.

## Still stubbed or incomplete

- F1: reconciliation currently covers processor/decision/ledger mismatches, processor-bank settlement, warehouse return exceptions, period backdating and fee classification. The current bridge consists of pairwise source deltas that foot to zero; it is not yet a cause-level bridge. Exception rows are clustered by cause for review, but playbooks and cent-verified explanations are not implemented.
- F2: the worker-to-SpacetimeDB close write path is implemented but not integration-tested against a running SpacetimeDB server. It records a blocked/ready close snapshot; it does not yet import monthly accrual/reversal entries from the bulk book or complete a controller lock workflow.
- F3: five paste-ready CREAO definitions, five mock schemas, account agent lookup and mock/live/replay adapter exist. Claim impact/reviewer and close/advisor runs are wired asynchronously; the Guardian is wired to the simulated portfolio. No CREAO agent is live or recorded for replay; no real run links exist. Droid finance investigation, cent-tie-out verifier and document intake are pending.
- F4: the Desk shows the seeded portfolio, obligations, close/bridge rows and CREAO connection/run proof. The claim analysis panel is wired to final audited refund decisions. Case-level journal posting, controller queue actions, audit-log detail and scenario console are pending.
- No live SpacetimeDB publish has been made as part of this continuation.
- This repo has no existing Playwright test files for the business path. The feature-flag off/on browser acceptance check remains outstanding.
- `npm run check` is blocked by the existing CREAO adapter test binding a local HTTP server (`listen EPERM` in this sandbox). Running the other 68 worker tests without that network test passes. `scripts/check-rules.ts` currently reports existing route-map/footer wording failures. `next build` is blocked because the sandbox cannot fetch the existing Google Fonts imports.

## Next gate's first step

Finish F3 by proving claim, close and Guardian agent-run reducers against a running SpacetimeDB module and finishing the exception-investigation verifier and driver board. Then complete the document intake slice. Live CREAO acceptance remains pending the human-created agents and credentials.
