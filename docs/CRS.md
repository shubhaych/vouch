# CRS: shopper identity and contact-risk screening

Read this before changing how Vouch uses CRS.

**Wired in (2026-10-25).** Each real claim's shopper is mapped onto a sandbox persona (`personaFor` in `worker/src/identity.ts`: about 85% P01, 5% each P12, P13, P16) and screened once by `screenClaim`, which the Desk Lead calls before the Risk Scorecard and the video reviewer calls while building the case; the worker also backfills older claims at startup. The redacted result is stored in the public `identity_screening` table (written only by the worker through `recordIdentityScreening`). The Risk Scorecard reads it as its `identity` indicator, in the claim investigation and in the Vouch score panel, so a screening can move caution and through it the score change. `/business` shows it as the "Identity screening (CRS)" metric. It never approves or declines a refund and never feeds the video evidence score.

## What CRS is for in Vouch

CRS answers one question: **do the identity and contact details supplied with a return need more verification?** It runs before the refund investigation and routes the case to one of three next steps. It never decides whether the item is defective and never approves or declines a refund.

| Product | Endpoint | What it returns |
| --- | --- | --- |
| Fraud Finder (AtData) | `POST /fraud-finder/fraud-finder` | `risk.score`, 0 to 100: how risky the email, phone, IP and address look. A contact-risk signal, **not a credit score**. |
| TransUnion TruValidate, basic | `POST /transunion/identity-manager-verification/basic` | `addOnProducts[].idManagerVerification.messages`: an empty list means name, SSN, birth date and address matched; each message is a discrepancy. |

Out of scope unless the user says otherwise: credit reports, FICO/Vantage scores, public, criminal or eviction records. Using credit data to judge a retail refund is not acceptable.

## What exists

| File | What it does |
| --- | --- |
| `worker/src/crs.ts` | The whole integration. `screen(personaId)` returns an `IdentityScreening`. In `CRS_MODE=sandbox` it logs in, calls both endpoints in parallel and normalises the answers; in `fixture` mode it returns hand-written results through the same normaliser. |
| `worker/src/env.ts` | `config.crs` (`mode`, `baseUrl`, `username`, `password`, and `configured`, true when sandbox credentials are set). The `.env` reader accepts quoted values, so passwords may contain `#`. |
| `worker/src/server.ts` | Three HTTP routes, below. |
| `worker/src/review/runner.ts` | The video reviewer already has a seam: while `config.crs.configured` is false it notes "Identity verification (CRS) is not configured" in the case limits. This is the natural place to call `screen()` and add the result to the case facts. |
| `worker/test/crs.test.ts` | Routing rules and the "missing data is unavailable, never a match" rule. Run `npx vitest run test/crs.test.ts` in `worker/`. |
| `worker/crs-personas.example.json` | Template for the persona file. |
| `.env.example` | `CRS_MODE`, `CRS_BASE_URL`, `CRS_USERNAME`, `CRS_PASSWORD`. |

### Worker routes

| Route | Body | Returns |
| --- | --- | --- |
| `GET /identity/status` | — | `{ mode, notReady }`; `notReady` explains what is missing in sandbox mode |
| `POST /identity/check` | `{ "personaId": "P12" }` | one `IdentityScreening` |
| `POST /identity/batch` | `{ "mix": { "P01": 900, "P12": 40, "P13": 30, "P16": 30 } }` | route counts for N returns mapped onto personas; each persona is checked once, so 1,000 returns cost at most 4 CRS calls |

### The normalised result

```ts
interface IdentityScreening {
  personaId: 'P01' | 'P12' | 'P13' | 'P16';
  source: 'fixture' | 'sandbox';
  contactRiskScore: number | null;
  contactRiskBand: 'low' | 'review' | 'unavailable';
  identityStatus: 'match' | 'discrepancy' | 'additional_verification' | 'unavailable';
  messages: { code: string; text: string }[];
  route: 'refund_investigator' | 'merchant_identity_review' | 'additional_verification';
  reasons: string[];   // plain-language rules that produced the route
  errors: string[];    // a failed call, never a judgement about the shopper
  checkedAt: string;
}
```

Routing rules (`normalize` in `crs.ts`, Vouch's rules, not CRS's):
- no score or no `idManagerVerification` → `additional_verification` (unavailable is never treated as risk or as a match);
- message `2401` (fraud alert on file) → `additional_verification`; a fraud alert may be one the consumer placed to protect themselves;
- any other message, or score ≥ 70 → `merchant_identity_review`;
- otherwise → `refund_investigator`.

## Setup

1. In the repo-root `.env` (git-ignored):
   ```
   CRS_MODE=sandbox
   CRS_BASE_URL=https://api-sandbox.stitchcredit.com/api
   CRS_USERNAME=...
   CRS_PASSWORD='...'      # quote it if it contains #
   ```
2. Create `worker/.keys/crs-personas.json` (git-ignored) from `worker/crs-personas.example.json`. The values are CRS's published test personas: `dist/test-data/personas.json` in the `@crscreditapi/crs-calhacks-mcp-server` npm package, or the Postman collection CRS emails. Use the Fraud Finder and `identity-manager-verification/basic` request bodies for P01, P12, P13 and P16. The worker refuses to call CRS while the file has `<placeholder>` values.
3. `npm run worker`, then `curl -X POST localhost:8787/identity/check -H 'content-type: application/json' -d '{"personaId":"P01"}'`.

## Sandbox facts (verified 2026-10-24)

- Login is `POST /users/login` with `{ username, password }`; the response has `token`, `expires` and `refreshToken`. Send `Authorization: Bearer <token>`.
- The sandbox answers **from a script**: each test persona always gets the same response and no real records are searched. In production the same calls check AtData and TransUnion files.
- Results seen:

| Persona | Score | Messages | Route |
| --- | --- | --- | --- |
| P01 Margaret Okafor | 11 | none | refund_investigator |
| P12 Victor Anand | 85 | 2201, 2202, 2101 | merchant_identity_review |
| P13 Kayla Brennan | 88 | 2201, 2202, 2101 (the guide says 2202 only) | merchant_identity_review |
| P16 Samuel Oyelaran | 50 | 2401 | additional_verification |

- CRS notes that 2101 is TransUnion's real address-mismatch code and that the 2201/2202/2301/2401 texts were written for the hackathon. Do not present them as production semantics.
- KBA and OTP are not available in this sandbox. Show "additional verification required" and route to a person; never fake a passcode or a passed KBA.

## Rules when you wire it in

- **Only the four personas.** Never send real or invented personal data: unrecognised data can reach a paid downstream provider. Simulated shoppers are mapped onto a persona; they never get their own identity data.
- **Secrets and PII stay in the worker.** The browser sends a persona id and receives an `IdentityScreening`. Never put credentials, tokens, SSNs, birth dates or raw vendor payloads in `web/`, a public SpacetimeDB table, logs or screenshots.
- **Repeated failed logins disable the account** (CRS113, then CRS114; only CRS can re-enable it). One rejected login is recorded in `worker/.keys/crs-login-failed` (a hash of the credentials, never the password) and those credentials are not tried again, even after a restart; the two product calls share one login. While the sandbox is unusable the worker uses labelled fixture screenings. Delete that file only once CRS confirms the credentials.
- **CRS is an input, not a decision.** Agents propose, people decide. A discrepancy is a reason for a person to look, not proof that the return is improper; keep the identity question separate from the item question.
- **Label provenance.** Sandbox results are real API responses to scripted personas; fixture results are `Fixture`. Batch mixes are synthetic: show routing counts, never fraud rates.

## Suggested next steps (not done)

1. **Claim intake:** when a claim is created, map its shopper onto a persona (deterministically, e.g. from the agent id and a chosen mix) and call `screen()` before the Refund Investigator runs: in `worker/src/orchestrator.ts`, or in the video reviewer at the `config.crs.configured` check in `worker/src/review/runner.ts`.
2. **Storage:** add a public, redacted table such as `identity_screening` (claim id, persona id, source, score, band, status, message codes, route, checked at) and a worker-only reducer to write it. Follow `docs/ARCHITECTURE.md`; the module entry file may export only reducers, views and procedures. Then `npm run stdb:publish` and `npm run stdb:generate`.
3. **Investigator input:** pass the `IdentityScreening` to the CREAO Refund Investigator as context (`worker/src/creao.ts` / `orchestrator.ts`) so its recommendation can cite it.
4. **UI:** show the score, messages, route and `reasons` on the `/business` claim view with the right provenance badge.
5. **Docs:** update `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md` and `docs/REAL_VS_SIMULATED.md` once CRS is part of the claim flow.
