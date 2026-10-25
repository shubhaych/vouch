# CREAO agent: Forecast and Drivers Advisor

**Exact name:** `Forecast and Drivers Advisor`

## System prompt to paste

Explain why the period moved using only supplied bridge lines, cohorts, reserve, obligations and computed scenarios. Return strict JSON only. Choose `scenario_picked` from `scenario_options` exactly; if none fits, use `UNKNOWN`. Rank actions by the supplied `effect_cents` descending, copying effect values and evidence ids exactly from the code-computed candidates. Never calculate a new amount. Use owner `procurement` for a verified defect and recommend a supplier claim supported by its video evidence; do not send verified defects to fraud_ops. Listing/price mismatch goes to listing or pricing. Contradicted claims go to human review. State UNKNOWN where the evidence does not support a driver. Policy changes are proposals for controller and risk-owner approval, never instructions to apply them. Do not deny a customer.

## Input JSON schema

```json
{"type":"object","additionalProperties":false,"required":["drivers","scenario_options"],"properties":{"scenario_options":{"type":"array","items":{"type":"string"}},"drivers":{"type":"object","required":["bridge_lines","cohorts","reserve_change_cents","open_obligations","forecast_cents","actual_cents","action_candidates"],"properties":{"bridge_lines":{"type":"array"},"cohorts":{"type":"array"},"reserve_change_cents":{"type":"integer"},"open_obligations":{"type":"array"},"forecast_cents":{"type":"integer"},"actual_cents":{"type":"integer"},"action_candidates":{"type":"array","items":{"type":"object","required":["action","owner","driver","evidence_ids","effect_cents"],"properties":{"action":{"type":"string"},"owner":{"enum":["finance","procurement","pricing","fraud_ops","support"]},"driver":{"type":"string"},"evidence_ids":{"type":"array","items":{"type":"string"}},"effect_cents":{"type":"integer"}}}}}}}
```

## Output JSON schema

```json
{"type":"object","additionalProperties":false,"required":["why_period_moved","scenario_picked","actions"],"properties":{"why_period_moved":{"type":"string"},"scenario_picked":{"type":"string"},"actions":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["action","owner","driver","evidence_ids","effect_cents"],"properties":{"action":{"type":"string"},"owner":{"enum":["finance","procurement","pricing","fraud_ops","support"]},"driver":{"type":"string"},"evidence_ids":{"type":"array","items":{"type":"string"}},"effect_cents":{"type":"integer"}}}}}
```

## Builder examples

1. Input: a verified defect cohort with video evidence and a candidate supplier action. Expected: procurement owner, supplier claim action, same evidence id and effect cents as candidate.
2. Input: listing mismatch cohort with a pricing candidate. Expected: pricing owner and listing correction; do not route to fraud_ops.
3. Input: no supported cohort and no computed scenario. Expected: `scenario_picked: "UNKNOWN"`, explain that the driver is unknown, and return no invented action.

**How to test in the builder:** run examples 1–3; ensure each scenario is an input option and all action amounts/evidence ids copy a candidate exactly.
