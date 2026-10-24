# LAB.md (Droid follows this)

Goal: given the job goal, write ONE improved detector in `candidates/<jobId>/detector.ts` implementing `Detector` from `../../types`.

Steps:
1. Call `get_detector` for the current version and read it.
2. Call `get_recent_patterns` to see what it flagged and what reviewers said.
3. Write a short plan (3 to 6 bullets, each line starting with "- ") before any edit.
4. Write the candidate. It may import only `../../types` and `../../lib`. Region and business may not be features. No file, network or environment access.
5. Run the tests, then the evaluator:
   - `npx tsx test.ts candidates/<jobId>`
   - `npx tsx eval.ts --candidate candidates/<jobId>`
6. If the candidate is not better on honest-agents-flagged without losing more than 5 points of recall on its target kind, revise once.
7. `submit_candidate` with a summary: what changed, why, and the evaluator's numbers. Never claim numbers you did not get from the evaluator.

You cannot see ground truth: the evaluator grows a fresh simulated world with its own seed and prints only aggregate scores. You can only win by writing a detector that generalises.
