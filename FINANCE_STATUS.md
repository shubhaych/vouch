# Refund Finance Desk status

Updated: 2026-10-24

## Current gate

F2 is in progress. F0 ledger/control logic and the seeded 100-company portfolio were added in commit `37c5455`; their module unit tests pass. F1 now has a reproducible DuckDB book, read-only monthly reconciliation, a three-source bridge that ties to zero, and a worker route that records a close snapshot into the company-scoped tables. The business-side Desk route is a first connected portfolio/close view behind the report-page `NEXT_PUBLIC_DESK=1` link.

## What is verified

- Module typecheck passes.
- Module tests pass: 68 tests, including balanced Maya workflow, ledger control refusals, deterministic portfolio simulation, and exposure tests.
- Worker typecheck passes.
- Worker reconciliation unit tests pass against an in-memory DuckDB fixture.
- Worker close adapter uses a separate `reconciler` identity; the optional worker startup bootstraps accountant, reconciler and analyst seats, prepares the book if missing and leaves the simulation paused. `POST /finance/close/:period` requires the configured controller code and records the source totals, bridge and exception clusters.
- The seeded generator produced 1,000,000 orders, 76,116 decisions, 101,041 processor rows, 100,741 bank rows, 39,873 warehouse rows, 201,722 ledger rows and 1,500 planted cases on this machine. A 2-run seed-17 test compared the full planted answer key and passed in about 2.3 seconds; timings vary by machine.
- `FINANCE_DESK=1` asks the worker to seed the portfolio catalog/rows on startup. It remains paused until a controller starts it from the Desk. The main refund path is unchanged when the flag is off.
- Finance agent status: **not created** for Finance Impact Analyst, Finance Impact Reviewer, Close Controller, Forecast and Drivers Advisor, and Exposure Guardian. No live IDs, links or credentials have been supplied.

## Still stubbed or incomplete

- F1: reconciliation currently covers processor/decision/ledger mismatches, processor-bank settlement, warehouse return exceptions, period backdating and fee classification. The current bridge consists of pairwise source deltas that foot to zero; it is not yet a cause-level bridge. Exception rows are clustered by cause for review, but playbooks and cent-verified explanations are not implemented.
- F2: the worker-to-SpacetimeDB close write path is implemented but not integration-tested against a running SpacetimeDB server. It records a blocked/ready close snapshot; it does not yet import monthly accrual/reversal entries from the bulk book or complete a controller lock workflow.
- F3: all five CREAO definitions and the mock/live/replay finance client are pending. Droid finance investigation and verifier are pending.
- F4: the Desk currently shows the seeded portfolio, obligations, and stored close/bridge rows. Case-level finance hook, controller actions, audit/proof screens and scenario console are pending.
- No live SpacetimeDB publish has been made as part of this continuation.
- This repo has no existing Playwright test files for the business path. The feature-flag off/on browser acceptance check remains outstanding.
- `npm run check` is blocked by the existing CREAO adapter test binding a local HTTP server (`listen EPERM` in this sandbox). Running the other 68 worker tests without that network test passes. `scripts/check-rules.ts` currently reports existing route-map/footer wording failures. `next build` is blocked because the sandbox cannot fetch the existing Google Fonts imports.

## Next gate's first step

Finish F1 by generating the monthly source totals and exception rows from DuckDB, creating a bridge that sums to zero, and writing those results to the company-scoped finance close and bridge tables. Then add reproducibility and bridge tie-out checks before proceeding to F2.
