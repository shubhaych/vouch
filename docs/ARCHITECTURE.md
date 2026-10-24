# Architecture

```
 browser (web/)  ──subscribe──┐
                              ▼
                      SpacetimeDB module (module/)  ◄──reducers/subscribe──  worker/ (Desk Lead)
                      tables, reducers, schedule                              │  CREAO API Trigger + webhook
                      segregation of duties                                   │  CRS, Nessie, risk model (ml/)
```

One database, one live bus. The browser reads through subscriptions and writes through reducers. Anything slow or secret runs in the worker, which holds the `capi_` keys. Agents never touch the database: they return one JSON object, the worker validates it and writes through a reducer.

## Where things go

| I want to... | Do this |
| --- | --- |
| Add a page | Create `web/app/<name>/page.tsx`, add it to `web/lib/routes.ts`. `npm run check:rules` fails if a nav link has no page. |
| Show live data | Use a hook from `web/lib/data/hooks.tsx`. Handle `disconnected`, `loading` and `ready` (`EmptyState` for the first two). Badge every number with `ProvenanceBadge`. |
| Add a table | Define it in `module/src/schema.ts` and add it to the `schema({...})` call. Public tables hold ids, hashes, tiers and reason codes only; PII and image bytes are private. |
| Add a reducer | Put it in the matching file (`claims.ts`, `vouch.ts`, `desk.ts`, ...), or a new file re-exported from `module/src/index.ts`. Gate it with `requireRole`. |
| Change a lane rule | Edit `module/src/policy.ts` and its tests. It is a pure function: no model output ever picks a lane. |
| Add an agent seat | Add the seat to `Seat` in `module/src/types.ts`, a case in `worker/src/route.ts`, env vars in `.env.example` (`CREAO_<SEAT>_APP_ID`, `CREAO_<SEAT>_KEY`), and a row in `docs/CREAO.md`. |

Shared pure code (`types.ts`, `handshake.ts`, `policy.ts`) must not import `spacetimedb`: web and worker import it as `@vouch/module/types`, `@vouch/module/policy`, `@vouch/module/handshake`.

## Roles (segregation of duties, `module/src/desk.ts`)

| Role | Who | May |
| --- | --- | --- |
| `controller` | A person (first caller of `claimController`) | Grant roles, flip the kill switch, edit the policy, approve above materiality |
| `router` | The worker's Desk Lead | Write lanes, Vouch Records, incidents and run rows |
| `proposer` | A CREAO seat's identity | Propose decisions only |
| `approver` | A person or the controller | Approve or reject a proposal that is not their own |
| `poster` | The ledger poster | Post a balanced entry for an approved decision |

One identity holds one role. The `router` role is an addition to the guide's four.

## Connecting SpacetimeDB (the hour-3 gate)

Unverified: the `spacetime` CLI was not available when the module was written, so publishing has never been tried. The module type-checks against `spacetimedb@2.13.0`.

1. Install the CLI from the SpacetimeDB quickstart; `spacetime start` for a local server.
2. `npm run stdb:publish`, then `npm run stdb:generate`. Both scripts carry flags that must be confirmed against the 2.x docs.
3. Mount `SpacetimeDBProvider` in `web/app/providers.tsx` and replace hook bodies in `web/lib/data/hooks.tsx`.
4. In the worker, connect with `DbConnection.builder()`, replace `createMemoryHub()` in `worker/src/hub.ts` with a reducer-backed Hub, and subscribe to `claim`, `vouch_record` and `config`.
5. Call `claimController` once from a browser identity, then `grantRole` for the worker (`router`) and each seat.
6. Pass: one table public, a live row visible in two tabs and in the worker. Fail: port the plain tables to Convex and remove the SpacetimeDB claims from the README.

## Things to verify when the module is first published

- The reducer files re-exported from `index.ts` register (SpacetimeDB reads exports from the entry file).
- `import { Timestamp } from 'spacetimedb'` bundles inside the module (used in `vouch.ts`); otherwise compute the expiry another way.
- Helpers typed as `{ db: any }` (`roleOf`, `requireRole`, `loadPolicy`) work as written.
- The ledger is a table only: nothing appends or hash-chains yet (needs a hashing approach inside the module, or have the worker compute and pass hashes).
- `merchant_policy.policyJson` is parsed with `JSON.parse` in `claims.ts`; confirm that is fine inside reducers.

## Known gaps in the backbone

- No auth: the web app has no signed-in shopper; `VouchRecordView` uses an empty subject id.
- `desk.ts` keeps `MATERIALITY_CENTS` as a constant; the merchant policy value is not read there yet.
- The risk dial has no math behind it yet (`riskDialLossPer1000Cents` is stored, nothing derives caps from it).
