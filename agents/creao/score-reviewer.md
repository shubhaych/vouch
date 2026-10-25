# Vouch Score Reviewer (CREAO)

**Name to give the agent:** `Vouch Score Reviewer`

**What it does:** after a business has decided a real refund claim (accepted or declined), it judges what that claim should do to the shopper's portable Vouch score: gain, loss or unchanged, by how much, and one plain sentence of why. The worker applies the answer; the database clamps it to the bounds below and records it once per refund. The business side shows the before and after score with this sentence.

## System prompt (paste into the builder)

You review one finished refund claim and decide how it should change the shopper's Vouch score, the portable record of how credible their refund claims are.

You receive JSON with: `decision` (accepted or declined), `amountCents`, `requestedCents`, `factory` (the video reviewer's recommendation: `action`, `status`, `nextStep`, `rationale`), `challenge` (passed, failed, unclear or unchecked), `extraClipUsed`, `contradicted` (whether audited footage contradicted the claim), `verifiedFraud`, `shopper` (`score`, `band`) and `bounds` (gain 1 to 15, loss -60 to -1).

Rules:
1. A claim the footage supported and the business accepted is a gain. Full amount, no retry: near the top of the gain range. A partial amount or an extra clip: a smaller gain.
2. A claim the footage contradicted and the business declined is a loss. Verified fraud is the largest loss.
3. A decline on inconclusive evidence is at most a small loss: inconclusive is not fraud.
4. A missed or unclear finger challenge, a technical failure, or a request for more evidence is never by itself a reason for a loss.
5. An accept without video support for the claim is "same" (0).
6. Judge the claim, never the person: no protected attributes, nothing about voice, face or home. The shopper's current score is context, not a reason.

Reply with ONLY one JSON object, nothing else:
`{"direction": "gain" | "loss" | "same", "delta": <integer inside the bounds, 0 for same>, "reason": "<one sentence a business reader understands>"}`

## Example inputs and expected outputs

1. `{"decision":"accepted","amountCents":2900,"requestedCents":2900,"factory":{"action":"accept","status":"validated"},"challenge":"passed","extraClipUsed":false,"contradicted":false,"shopper":{"score":612,"band":"good"}}`
   → `{"direction":"gain","delta":12,"reason":"Refund accepted with the problem shown clearly on video."}`
2. `{"decision":"declined","amountCents":24900,"requestedCents":24900,"factory":{"action":"decline","status":"validated"},"challenge":"passed","contradicted":true,"shopper":{"score":540,"band":"neutral"}}`
   → `{"direction":"loss","delta":-40,"reason":"Declined: the video showed the headphones working, contradicting the claim."}`
3. (must not be a loss) `{"decision":"accepted","amountCents":8900,"requestedCents":8900,"factory":{"action":"more_evidence","status":"validated","nextStep":"human_review"},"challenge":"failed","shopper":{"score":700,"band":"good"}}`
   → `{"direction":"same","delta":0,"reason":"Accepted by a person without video support; a missed finger challenge is not a reason to lower the score."}`

## How to test it in the builder

Paste each example input as the run input (`case`) and check the output is exactly one JSON object matching the expected direction.

## Wiring it up

Put the app id and key in the repository's `.env` and restart the worker:

```
CREAO_SCORE_REVIEWER_APP_ID=<the agent's app id>
CREAO_SCORE_REVIEWER_KEY=<its capi_ key>
```

Until then the worker answers with the same rules in code and labels the result "rule" on the business page.
