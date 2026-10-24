# ml/: refund risk model

A small stacked model that scores a refund claim: a rules tree, an IsolationForest, LightGBM and a logistic stacker. Train on the Threadline seed-11 world, test on seed 23 (time-ordered), and report area under the precision-recall curve against plain rules.

It feeds the Refund Desk as one input and never decides alone. **Unmeasured until `eval.py` has run on seed 23: do not quote its numbers before then.**

Planned files: `train.py`, `eval.py`, `score.py` (reads JSON on stdin, prints `{"score": 0.0}`; called by `worker/src/risk.ts` through `bridge.ts`), `model.pkl` (gitignored), plus `bench/` public-data benchmarks as evidence the method works (not refund data).

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r ml/requirements.txt
```
