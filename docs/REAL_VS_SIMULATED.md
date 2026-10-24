# What is real, what is simulated

One line per step, added when the step lands. Nothing here is claimed Live until a command in the last column has printed a real response.

| Thing | Status today | How to check |
| --- | --- | --- |
| Policy Engine and handshake | Real code, unit tested, no data flows through it yet | `npm test -w module` |
| SpacetimeDB module | Type-checks only; never published | `npm run typecheck -w module` |
| CREAO adapter | Tested against a stand-in server; never called CREAO | `npm test -w worker`, then `npm run hello:creao` |
| CRS identity | Not called | `npm run hello:crs` (script is a stub until the hackpack is open) |
| Nessie payment history | Not called | `npm run hello:nessie` |
| Threadline retailer | Not added yet; will be Simulated | `world/README.md` |
| Customers, claims, photos | Empty seed files; will be Seeded | `seed/README.md` |
| Speed-versus-loss curve | Placeholder; will be Simulated | `/atlas` |
| Refund risk model | Not started; unmeasured | `ml/README.md` |
| Proof panel numbers | Copied from the guide; Simulated detectors on a simulated company | `/atlas#proof`, `world/` once added |
