# Hyphenate: the seats Vouch Desk fills

Company: Threadline (simulated fashion marketplace). Corner: refunds, from the customer's request to the ledger entry, including the credit decision of how fast to pay.

| Seat | Vouch Desk agent | Access and limits | Asks a person when |
| --- | --- | --- | --- |
| Refund and dispute analyst | Refund Desk (CREAO) | Reads orders, claims, carrier, ledger summaries; writes proposals only | Lane C or D, an amount above the cap, sources that disagree |
| Credit analyst | Credit Analyst (people), Agent-Order Underwriter (shopping agents) | Reads identity, payment, order and refund history; writes a Vouch Record with an expiry; cannot pay | A new customer with a large claim, an agent outside its mandate, a limit increase |
| Cash applier and reconciler | Reconciler (CREAO) | Read-only on all four sources; writes findings | A break above materiality, or a cause it cannot establish |
| Revenue and close accountant | Ledger Poster (deterministic worker; a CREAO agent drafts the memo) | Posts only balanced entries that cite an approved decision | Cutoff items and anything above materiality |

The controller approves anything above $500 and any policy change. The Desk Lead is worker code, not an agent.

Where each control lives: segregation of duties in `module/src/desk.ts`; the lane rule in `module/src/policy.ts`; the kill switch in `module/src/claims.ts` and `worker/src/breaker.ts`. Proof (planted errors, answer key, Beancount books) comes from `world/` once added.
