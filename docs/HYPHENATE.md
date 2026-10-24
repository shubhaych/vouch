# Hyphenate: the finance seat Vouch fills (kept eligible, not the centre)

Hyphenate is not one of the three sponsors this build centres on. It stays eligible because the business dashboard already fills a finance seat.

**Company:** a simulated online retailer (businesses B-002 Circuit Yard and B-019 Lakeshore Audio in Vouch World). **Corner:** refunds, from the customer's claim to the journal entry.

| Seat | Who fills it in Vouch | Access and limits | Asks a person when |
| --- | --- | --- | --- |
| Refund and dispute analyst | The Refund Investigator (CREAO) proposes; the business seat decides | The agent reads the claim, the Evidence Analyst's findings, the history summary, any credential check and the policy. It writes nothing; the worker turns its JSON into a proposal. | Always: an agent only proposes. Unverifiable evidence becomes "more evidence", never a decline. |
| Controller | A person with the controller code | Decides any accept above $500, flips controls, promotes Droid candidates | — |
| Revenue and close accountant | The ledger poster: a second worker identity, deterministic code, not an agent | Posts only a balanced entry (4100 Refunds and returns against 1000 Cash or 2300 Store credit liability) for a decided refund | An entry that does not balance is refused |

Controls, all in `module/src/desk.ts` and tested in `module/src/reducers.test.ts`:
- whoever proposes cannot decide; whoever decides cannot post;
- an accept above $500 by a business seat goes to the controller;
- with the agents switched off, the business can only request more evidence.

What is real and what is simulated: the decisions, the role checks and the journal entries are live reducers; the money, the businesses and the shoppers are simulated. See [REAL_VS_SIMULATED.md](REAL_VS_SIMULATED.md).
