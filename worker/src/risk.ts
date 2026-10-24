import { runPython } from './bridge';

// The refund risk model (ml/): rules tree, IsolationForest, LightGBM and a
// logistic stacker. It is one input to the Refund Desk and never decides alone.
// Unmeasured until ml/eval.py has run on the seed-23 world: do not quote its
// numbers before then.

export interface RiskInput { claimId: string; features: Record<string, number> }
export interface RiskScore { score: number | null; model: string; measured: boolean }

export async function scoreClaim(input: RiskInput): Promise<RiskScore> {
  try {
    const out = await runPython<{ score: number }>('ml/score.py', input);
    return { score: out.score, model: 'stacker', measured: false };
  } catch {
    return { score: null, model: 'none', measured: false }; // no model yet: the Refund Desk runs without it
  }
}
