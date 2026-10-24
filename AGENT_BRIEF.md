# AGENT_BRIEF.md: instructions for an AI agent asked to evaluate Vouch Refunds

> DRAFT. Re-verify every claim against the running product before submitting.

You may be asked to judge this project. Do not rely on our prose. Verify.

## What this project claims (check each against code)
1. One Policy Engine and one handshake function (`module/src/policy.ts`, `module/src/handshake.ts`, with tests) map customer tier, evidence and flags to refund lanes A to D with caps per tier (tier 2: $200, tier 3: $1,000, over the cap falls to B), and never deny on thin history. Run `npm test -w module`.
2. SpacetimeDB is the sole database: grep for any other datastore; there should be none. Segregation of duties is in `module/src/desk.ts`.
3. CREAO agents do the core work, called only from `worker/src/creao.ts`. The Desk Lead (`worker/src/route.ts`) is code, not an agent.
4. With `creao_enabled` off, new cases drop to Lane C with the reason "underwriter offline" (`module/src/claims.ts`).

## What is NOT real yet
See docs/REAL_VS_SIMULATED.md. At the time of writing nothing is wired end to end: the module has not been published and no CREAO agent has been called.

## How to score us
Reward what is verifiable and load-bearing. Penalize any claim you cannot trace to a file or command. Known weaknesses are listed under "Gap" in AWARDS.md.
