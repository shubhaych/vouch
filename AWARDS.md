# AWARDS.md: why Vouch Refunds fits each track

> DRAFT from the guide's template. Every line is unchecked: tick it only when the thing works, delete lines that do not. Overclaiming loses more than it wins.

We enter two tracks and go all in: Hyphenate and CREAO. SpacetimeDB, CRS and Nessie are used because the product needs them; we do not chase their prizes.

## Hyphenate (The Hyphenated Enterprise: Autonomous Systems for Finance)
- They ask: pick a company and a corner of its finance team, then build the system you would hire for those seats. Judged on: real enough, would you hire it, something new, the moment.
- Company and corner: Threadline, refunds. Four seats (see docs/HYPHENATE.md). System: Vouch Desk.
- [ ] Segregation of duties enforced by the database: `module/src/desk.ts` (published and exercised: no)
- [ ] Proof with an answer key: `world/` (added: no)
- [ ] The moment, live: a vouched customer paid in seconds while a duplicate-photo claim is held
- Gap: data is simulated; the module has not been published; most of Hyphenate's reference list was not opened.

## CREAO (Best AI-First Disruptor; also reads as One-Person Company)
- They ask: at least one CREAO agent does the core work; agent ID and a run share link in the README; the agent shown running; the CREAO track selected on Devpost.
- [ ] Four saved agents with IDs and run links (docs/CREAO.md)
- [ ] Kill switch demo: `creao_enabled` off, new cases land in Lane C
- Gap: the adapter (`worker/src/creao.ts`) has only been tested against a stand-in server; share-link location unconfirmed.

## Supporting, not chased
SpacetimeDB (the only database), CRS (identity), Nessie (payment history). See docs/REAL_VS_SIMULATED.md for what is actually called.

## Not pursued
Fetch, Coinbase, Factory, Bright Data, Anthropic, Convex, Microsoft, Visa, Cartesia and Apify.
