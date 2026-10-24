# CREAO: four saved agents

Rule: at least one CREAO agent does the core work. Remove the agents and no Vouch Record is issued; the kill switch holds every new case in Lane C with the reason "underwriter offline".

| Seat | Agent | Env vars | Started by | Agent ID | A real run |
| --- | --- | --- | --- | --- | --- |
| `credit_analyst` | Credit Analyst | `CREAO_CREDIT_ANALYST_APP_ID`, `_KEY` | New or expired customer record, or an incident | _fill in_ | _fill in_ |
| `agent_order` | Agent-Order Underwriter | `CREAO_AGENT_ORDER_APP_ID`, `_KEY` | An agent registers or places an order | _fill in_ | _fill in_ |
| `refund_desk` | Refund Desk | `CREAO_REFUND_DESK_APP_ID`, `_KEY` | A contested claim, chargeback, or post-payment review | _fill in_ | _fill in_ |
| `reconciler` | Reconciler | `CREAO_RECONCILER_APP_ID`, `_KEY` | Nightly schedule or any break | _fill in_ | _fill in_ |

How the worker calls them: `worker/src/creao.ts` (`startRun`, `pollRun`, `onWebhook`, `parseVerdict`). Webhooks are at-least-once and deduped on `X-Creao-Delivery-Id`; polling is the fallback because no webhook is sent for a run that fails before it starts. The adapter has not been run against CREAO itself.

Booth checks still open: where the interface shows a run share link (the API docs do not return one); image input and structured JSON output; credit budget (a full demo is about 15 runs); whether the Refund Desk's write setting must be "run automatically".

Agent prompts are in the build guide, section "Paste-in agent prompts". Create each agent on agent.creao.ai, paste its prompt, save with Create Agent, and test it on ten Threadline cases against the answer key before wiring it in.
