# CREAO fixtures

Used when `CREAO_MODE=fixture` (tests, and development without keys). Every result built from these is labelled **Fixture** in the UI (`agent_run.mode = fixture`, `evidence.provenance = fixture`).

The files here are **hand-written from the JSON shapes in the spec's Appendix A**, not recorded from real runs (no CREAO agent has been called from this repo yet). After the three agents exist, run `npx tsx scripts/hello-creao.ts --record` to save real responses as `<seat>.recorded.*.json`; recorded files take precedence over hand-written ones.

`{{placeholders}}` are filled from the case so the shapes line up with the claim being shown.
