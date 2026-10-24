# Benchmarks

Detector scores on Threadline (simulated company, deterministic detectors). The standard set was used to tune the rules desk; the held-out set is the honest number.

| Detector | Standard set (seed 11: 64 planted refund errors, 2,532 orders) | Held-out set (seed 23: 70 planted refund errors, 2,623 orders) |
| --- | --- | --- |
| Plain rules | Caught 58, 106 false alarms | Caught 63, 103 false alarms |
| Rules desk | Caught 64, 0 false alarms | Caught 63, 4 false alarms |

Copied from the build guide; reproduce with `world/` once the Threadline files are added.

Still to measure, against the same answer key: each CREAO agent (ten cases per seat) and the refund risk model (train seed 11, test seed 23, area under the precision-recall curve against plain rules). Report whatever they score next to the two baselines.
