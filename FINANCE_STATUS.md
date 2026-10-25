# Refund Finance Desk status

Updated: 2026-10-24 (F3 playbooks / verifier / driver board)

## Current gate

F3 is still in progress. F0–F2 (ledger, reconciliation, close snapshots) and the CREAO mock/live adapter remain. This step added deterministic playbooks, a cent-tie-out Verifier, a cause-level variance bridge, and the code-built driver board wired into close and the Desk UI.

## What is verified

- Module typecheck passes.
- Module tests pass: 68 tests, including balanced Maya workflow, ledger control refusals, deterministic portfolio simulation, and exposure tests.
- Worker typecheck passes.
- Worker finance unit tests pass: reconciliation (including cause bridge), playbooks/verifier/driver board (6 new tests), CREAO mock schemas.
- Verifier accepts a tied-out playbook proposal and rejects a deliberately wrong explanation (unbalanced entry, bad parts sum, unknown cited id).
- Close path: reconcile → clusterExceptions → verifyClusters → causeBridge → buildDriverBoard → `financeRecordClose` with funnel counts (`closedByPlaybook`, `toInvestigator`, `toController`).
- Desk Close panel shows funnel counters, cause bridge, exception clusters and playbook status; Driver board panel lists ranked actions with owners.
- Close/Advisor CREAO inputs now receive the code-built driver actions (Advisor remains mock until live agents exist).
- Finance agent status: **not created** for all five seats. `npm run creao:check` needs `CREAO_API_KEY`. Mock outputs are labeled Simulated and are not live acceptance evidence.
- WAITING FOR HUMAN: create Finance Impact Analyst in CREAO and set `CREAO_AGENT_IMPACT_ANALYST`.
- WAITING FOR HUMAN: create Finance Impact Reviewer in CREAO and set `CREAO_AGENT_IMPACT_REVIEWER`.
- WAITING FOR HUMAN: create Close Controller in CREAO and set `CREAO_AGENT_CLOSE_CONTROLLER`.
- WAITING FOR HUMAN: create Forecast and Drivers Advisor in CREAO and set `CREAO_AGENT_ADVISOR`.
- WAITING FOR HUMAN: create Exposure Guardian in CREAO and set `CREAO_AGENT_GUARDIAN`.

## Still stubbed or incomplete

- F1/F2: cause bridge now foots from exception causes + residual; full close against a live SpacetimeDB server and controller lock workflow still need an integration pass. Bulk-book accrual import into SpacetimeDB is not done.
- F3 remaining: Droid exception investigator (7.1–7.5), document intake, AskUser / rewind UI. Live CREAO runs remain blocked on human-created agents.
- F4: Case screen depth (sources side-by-side, journal lines, both judgments), controller queue actions, audit log detail, scenario console, scorer (`score.ts` / `FINANCE_SCORE.md`), red team, Playwright desk + main-path flag off/on.
- No live SpacetimeDB publish was made as part of this step.
- `npm run check` may still hit sandbox `listen EPERM` on the existing CREAO HTTP adapter test; finance unit tests alone pass.

## Next gate's first step

Build the Droid Exception Investigator worker (fenced MCP tools, structured output, Verifier gate) behind mock/replay so close clusters with status `unexplained` can be investigated without a key. Then Case/Controller screens (F4 thin slice).
