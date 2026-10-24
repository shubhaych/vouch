# Vouch Refunds: refund good customers faster, and let an AI check the rest

Refunds are either instant and abused, or slow and resented. Vouch gives a retailer's refunds team a stored, expiring Vouch Record for each customer (tier 0 to 3, with reasons), a refund ladder that pays trusted customers in minutes, a CREAO agent that checks the contested claims, and the same record for the AI agents that will soon shop for people. It shows its evidence and says "unable to verify" instead of guessing.

> **Status: backbone only.** The routes, schema, policy engine and worker skeleton exist and are tested. Nothing is wired end to end yet: the SpacetimeDB module has been type-checked but never published, no CREAO agent has been called, and every page shows an honest empty state. See [docs/REAL_VS_SIMULATED.md](docs/REAL_VS_SIMULATED.md) for what is real today.

## Run it

```bash
nvm use            # Node 22+
npm install
cp .env.example .env
npm run dev        # http://localhost:3000
npm run check      # typecheck, lint, tests, rule checks
```

Pages: `/` `/atlas` `/console` (Cases, Evidence, Books) `/shopper` (Return, My Vouch Record) `/agents` `/merchant`.

## Four layers, one engine

| Layer | Problem | What Vouch does |
| --- | --- | --- |
| Vouch the customer | A refunds team cannot tell a good customer from a bad one in time | Vouch Record: tier 0 to 3, reasons, expiry, built by the Credit Analyst agent |
| Refund more, sooner | Instant refunds get abused, slow ones lose good customers | Refund ladder A/B/C/D with caps per tier, and a merchant risk dial |
| Check the claim | Contested claims are reviewed by hand | Refund Desk agent plus a refund risk model and photo hashes; it proposes, a person decides |
| Foundations for agent shoppers | Nobody can tell trustworthy shopping agents apart | Agents register with a principal and a mandate; the Agent-Order Underwriter returns allow, escrow, step up or block |

## What is in the repo

| Path | What | State |
| --- | --- | --- |
| `web/` | Next.js app, six pages, shared components, data-hook seam | Built, renders empty states |
| `module/` | SpacetimeDB schema and reducers; pure `handshake` and `decide` | Type-checked; 24 tests pass; never published |
| `worker/` | Desk Lead: CREAO adapter, routing, circuit breaker | Tested against a stand-in server; not run against CREAO |
| `world/` | Threadline simulated company | Not yet added (needs `threadline_world.zip`) |
| `ml/` | Refund risk model | Not started |
| `seed/`, `scripts/` | Demo data and hello scripts | Stubs |

## Next steps

1. Hour-3 gate: install the `spacetime` CLI, `npm run stdb:publish`, `npm run stdb:generate`, and show one live row in two tabs and in the worker.
2. Run the hello scripts to learn which sponsor APIs are actually usable.
3. Drop `threadline_world.zip` into `world/`.
4. Build the hero path (see `AGENTS.md`, build order step 3).

## Limits and compliance

Test identities only. Using credit-bureau data to set refund speed would need legal review before production. Photo checks cannot authenticate images and say so. A tier-0 customer is asked to verify, not rejected. No secrets in this repo.
