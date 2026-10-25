# Finance Desk CREAO agents

Create each saved agent manually in CREAO. The worker supports mock mode before agents exist; no agent ID or run link is invented.

1. Open the matching definition below and create an agent with the exact name shown at the top.
2. Paste its complete **System prompt** into the CREAO builder. Configure the builder to accept and return JSON using the included schemas.
3. Run all three builder examples. Check the required flags, numeric inputs, escalation behavior, and refusal case.
4. Create/enable that agent's API app in CREAO, then copy its **App ID** and app-scoped **API key** into the worker's git-ignored `.env` using the matching variable pair below.
5. Run `npm run creao:check` to confirm each pair is present. App-scoped credentials cannot list account agents, so the first live run validates that CREAO accepts the pair and that its output passes the schema. Keep `FINANCE_CREAO_MODE=mock` until ready for that live run.

| Exact CREAO name | Definition | Environment variable | Status |
| --- | --- | --- | --- |
| Finance Impact Analyst | [impact-analyst.md](impact-analyst.md) | `CREAO_FINANCE_IMPACT_ANALYST_APP_ID` + `CREAO_FINANCE_IMPACT_ANALYST_API_KEY` | not created |
| Finance Impact Reviewer | [impact-reviewer.md](impact-reviewer.md) | `CREAO_FINANCE_IMPACT_REVIEWER_APP_ID` + `CREAO_FINANCE_IMPACT_REVIEWER_API_KEY` | not created |
| Close Controller | [close-controller.md](close-controller.md) | `CREAO_FINANCE_CLOSE_CONTROLLER_APP_ID` + `CREAO_FINANCE_CLOSE_CONTROLLER_API_KEY` | not created |
| Forecast and Drivers Advisor | [forecast-drivers-advisor.md](forecast-drivers-advisor.md) | `CREAO_FINANCE_ADVISOR_APP_ID` + `CREAO_FINANCE_ADVISOR_API_KEY` | not created |
| Exposure Guardian | [exposure-guardian.md](exposure-guardian.md) | `CREAO_FINANCE_GUARDIAN_APP_ID` + `CREAO_FINANCE_GUARDIAN_API_KEY` | not created |

Set these ten values in the worker `.env` only. Keep the app keys out of `web/` and all browser bundles. `FINANCE_CREAO_MODE=mock` is the default. `FINANCE_CREAO_MODE=replay` reads recorded results from `worker/fixtures/finance/*.jsonl`. `FINANCE_CREAO_MODE=live` runs each seat through its app-scoped API key. Add `RECORD_FINANCE_CREAO=1` to record schema-valid real outputs for replay. The existing `CREAO_API_KEY` and original agent credentials are separate and remain for the Vouch shopper flow.

The finance adapter validates every output before it reaches the Desk. Mock output is labelled **Simulated (agent not connected)**; replay output is labelled **Replay of real run**; only a validated CREAO response is labelled **Live**. Finance CREAO status is tracked in [FINANCE_STATUS.md](../../FINANCE_STATUS.md).
