# CRS: the identity step-up in the claim flow

Read this before changing CRS anywhere in Vouch.

**Use case: identity before trust.** A refund paid before the item comes back is an advance. Claims from shoppers with a thin history (< 3 completed purchases or < 30 days), without a verified Vouch credential, or above the store's auto-approve limit get a CRS screening at intake, before any investigator runs (`stepUpTrigger` in `worker/src/identity.ts`). A clean match counts as a verified identity (the video reviewer's `pLegit` formula treats it like a verified credential); a discrepancy sends identity to a person, separately from the item; a fraud alert asks for step-up proof. Established, credential-holding shoppers under the limit are not screened at all.

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
- **Repeated failed logins can lock the account.** The client waits 5 minutes after a failed login; keep that.
- **CRS is an input, not a decision.** Agents propose, people decide. A discrepancy is a reason for a person to look, not proof that the return is improper; keep the identity question separate from the item question.
- **Label provenance.** Sandbox results are real API responses to scripted personas; fixture results are `Fixture`. Batch mixes are synthetic: show routing counts, never fraud rates.

## Wired in (2026-10-25)

| Where | What |
| --- | --- |
| `worker/src/identity.ts` | `IdentityDesk`: `stepUp()` (decide and screen once per refund), `screenRefund()` (record a redacted row), `forRefund()` / `caseIdentity()` (what the agents read), `screenSimulated()` (each new simulated investigation refund routed through its persona's cached screening; sandbox mode only), CRS health every 5 minutes |
| `worker/src/crs.ts` | Added: single-flight login (the two products no longer race two logins), refresh-token renewal, `GET /sys/health`, `personaFor(agentId)` (deterministic, mix P01 90%, P12 4%, P13 3%, P16 3%), `setCrsMeter()` (every request metered), `screenWithMeta()` (cached flag and latency), `CRS_PERSONAS_PATH` override for tests |
| Claim flow | `review/runner.ts` (video reviewer: verified identity in the formula, "Identity" section in the case file the Droid reviewer reads, a limit line when identity needs a person), `orchestrator.ts` and `review/score-review.ts` (the `identity` field of the Risk Scorecard and Refund Investigator cases), `fixtures.ts` (the Investigator cites `identity:crs`; a non-clean route lowers confidence and never changes the action) |
| Module | `identity_screening` (redacted: persona id, trigger, source, cached, score, bands, message codes, route, reasons, latency), `crs_call` (product, HTTP status, latency), `crs_stat` (totals). Worker-only reducers in `module/src/identity.ts` refuse non-persona ids, unknown routes, long or structured message codes, and SSN- or birth-date-shaped text |
| Web | `/business` Identity step-up card (`web/components/business/identity-card.tsx`), `/system` CRS panel (`web/components/system/crs-panel.tsx`) |
| Routes | `POST /identity/screen-refund` (controller code; re-screen a claim's shopper as a chosen persona, so a judge can see every route), `GET /identity/usage` (totals) |
| Scripts | `npx tsx scripts/hello-crs.ts [--record]` (login, health, the four personas; `--record` saves normalised results, no persona data, to `worker/fixtures/crs/recorded.json`), `npx tsx scripts/crs-usage.ts` (totals from the database), `scripts/env-check.ts` (CRS login check) |
| Tests | `worker/test/crs-client.test.ts` (stand-in CRS server: one login, bearer token, refresh, 401 retry, back-off, metering without payloads, health, placeholder refusal, persona mapping, token expiry), `worker/test/identity.test.ts` (step-up rules, redaction, never-decline), `module/src/identity.test.ts` (reducer guards and totals) |

Fixture mode writes screening rows labelled `fixture` and makes no CRS request; the simulation batch runs only with real sandbox answers, so its totals are never fiction.
