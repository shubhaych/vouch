# Finance Desk CREAO agents

Create each saved agent manually in CREAO. The worker supports mock mode before agents exist; no agent ID or run link is invented.

1. Open the matching definition below and create an agent with the exact name shown at the top.
2. Paste its complete **System prompt** into the CREAO builder. Configure the builder to accept and return JSON using the included schemas.
3. Run all three builder examples. Check the required flags, numeric inputs, escalation behavior, and refusal case.
4. Copy the agent ID into the worker's git-ignored `.env` using the matching variable below.
5. Run `npm run creao:check`. It reports whether each ID is set, found in the account, and attached to the expected name. Keep `FINANCE_CREAO_MODE=mock` until the check passes and a real run validates.

| Exact CREAO name | Definition | Environment variable | Status |
| --- | --- | --- | --- |
| Finance Impact Analyst | [impact-analyst.md](impact-analyst.md) | `CREAO_AGENT_IMPACT_ANALYST` | not created |
| Finance Impact Reviewer | [impact-reviewer.md](impact-reviewer.md) | `CREAO_AGENT_IMPACT_REVIEWER` | not created |
| Close Controller | [close-controller.md](close-controller.md) | `CREAO_AGENT_CLOSE_CONTROLLER` | not created |
| Forecast and Drivers Advisor | [forecast-drivers-advisor.md](forecast-drivers-advisor.md) | `CREAO_AGENT_ADVISOR` | not created |
| Exposure Guardian | [exposure-guardian.md](exposure-guardian.md) | `CREAO_AGENT_GUARDIAN` | not created |

Set `CREAO_API_KEY` and these five IDs in the worker `.env` only. Keep the key out of `web/` and all browser bundles. `FINANCE_CREAO_MODE=mock` is the default. `FINANCE_CREAO_MODE=replay` reads recorded results from `worker/fixtures/finance/*.jsonl`. `FINANCE_CREAO_MODE=live` runs the configured CREAO agent. Add `RECORD_FINANCE_CREAO=1` to record schema-valid real outputs for replay.

The finance adapter validates every output before it reaches the Desk. Mock output is labelled **Simulated (agent not connected)**; replay output is labelled **Replay of real run**; only a validated CREAO response is labelled **Live**. Finance CREAO status is tracked in [FINANCE_STATUS.md](../../FINANCE_STATUS.md).
