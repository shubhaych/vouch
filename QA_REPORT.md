# QA report, Loop 2, 2026-10-24 13:10 UTC

Mode: **Fixture** (`CREAO_MODE=fixture`; no CREAO agents or Droid in this session), local SpacetimeDB 2.13.0, started from `npx tsx scripts/demo-reset.ts` (seed 11, 10,000 agents, sim running). Every result below is a Fixture result. The live passes wait for keys: [docs/LIVE_CHECKLIST.md](docs/LIVE_CHECKLIST.md).

How it was run:
- `npx tsx qa/matrix.ts --p3 qa/agent-<id>.json`: the video matrix through the real reducers and the upload route. Output: `qa/results/matrix-fixture.json`.
- `npx playwright test qa/personas.spec.ts`: the personas in the browser, with screenshots in `qa/shots/`.
- `npx tsx qa/unhappy.ts`: the kill switch mid-run and a worker restart mid-claim. Output: `qa/results/unhappy.json`.
- `npx playwright test e2e/`: the smoke tests.

The step list is in [qa/checklist.md](qa/checklist.md).

## Summary: PENDING

## Video matrix

PENDING

## Issues

PENDING
