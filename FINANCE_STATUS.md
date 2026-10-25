# Refund Finance Desk status

Updated: 2026-10-24

## Current gate

F1 is in progress. F0 ledger/control logic and the seeded 100-company portfolio were added in commit `37c5455`; their module unit tests pass. The first DuckDB book and a read-only reconciliation query are implemented locally. The business-side Desk route is a first connected portfolio view behind the report-page `NEXT_PUBLIC_DESK=1` link.

## What is verified

- Module typecheck passes.
- Module tests pass: 68 tests, including balanced Maya workflow, ledger control refusals, deterministic portfolio simulation, and exposure tests.
- Worker typecheck passes.
- Worker reconciliation unit tests pass against an in-memory DuckDB fixture.
- The seeded generator produced 1,000,000 orders, 76,116 decisions, 101,041 processor rows, 100,741 bank rows, 39,873 warehouse rows, 201,722 ledger rows and 1,500 planted cases on this machine. A 2-run seed-17 test compared the full planted answer key and passed in about 2.3 seconds; timings vary by machine.
- `FINANCE_DESK=1` asks the worker to seed the portfolio catalog/rows on startup. It remains paused until a controller starts it from the Desk. The main refund path is unchanged when the flag is off.
- Finance agent status: **not created** for Finance Impact Analyst, Finance Impact Reviewer, Close Controller, Forecast and Drivers Advisor, and Exposure Guardian. No live IDs, links or credentials have been supplied.

## Still stubbed or incomplete

- F1: reconciliation currently covers processor/decision/ledger mismatches, processor-bank settlement, warehouse return exceptions, period backdating and fee classification. The current bridge consists of pairwise source deltas that foot to zero; it is not yet a cause-level bridge. Exception rows are not yet clustered, playbooks are not implemented, and results are not yet written to SpacetimeDB.
- F2: month close from the DuckDB book, accrual/reversal across book data, thresholds and complete review queue are not wired end to end.
- F3: all five CREAO definitions and the mock/live/replay finance client are pending. Droid finance investigation and verifier are pending.
- F4: the Desk currently shows the seeded portfolio and obligations. Case-level finance hook, source comparison, close/bridge, controller actions, audit/proof screens and scenario console are pending.
- No live SpacetimeDB publish has been made as part of this continuation.
- This repo has no existing Playwright test files for the business path. The feature-flag off/on browser acceptance check remains outstanding.
- `npm run check` is blocked by the existing CREAO adapter test binding a local HTTP server (`listen EPERM` in this sandbox). Running the other 68 worker tests without that network test passes. `scripts/check-rules.ts` currently reports existing route-map/footer wording failures. `next build` is blocked because the sandbox cannot fetch the existing Google Fonts imports.

## Next gate's first step

Finish F1 by generating the monthly source totals and exception rows from DuckDB, creating a bridge that sums to zero, and writing those results to the company-scoped finance close and bridge tables. Then add reproducibility and bridge tie-out checks before proceeding to F2.
