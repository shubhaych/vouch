# CREAO fixtures

Used when `CREAO_MODE=fixture` (tests, and development without keys). Every result built from these is labelled **Fixture** in the UI (`agent_run.mode = fixture`, `evidence.provenance = fixture`).

The files here are **hand-written from the JSON shapes in the spec's Appendix A**, not recorded from real runs (no CREAO agent has been called from this repo yet). After the three agents exist, run `npx tsx scripts/hello-creao.ts --record` to save real responses as `<seat>.recorded.*.json`; recorded files take precedence over hand-written ones.

`{{placeholders}}` are filled from the case so the shapes line up with the claim being shown.

## Video reviewer seats

`refund_reviewer.agree.json` / `refund_reviewer.disagree.json` stand in for the **Vouch Refund Reviewer** (it reads the business report and says whether it agrees with the tier) and `customer_liaison.message.json` for the **Vouch Customer Liaison** (the customer-facing message). The fixture Reviewer disagrees when the report's own limits or integrity flags are serious (frame reuse, a failed challenge, lanes-only analysis for a T1), which is the behaviour the saved agent's prompt asks for.
