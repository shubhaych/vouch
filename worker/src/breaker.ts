// Circuit breaker. Fail closed: with agents switched off, or with no agent run
// completed inside the expiry window, the instant lane is unavailable and new
// cases drop to Lane C with the reason "underwriter offline".

export function underwriterOnline(opts: { enabled: boolean; lastCompletedRunAt: Date | null; now: Date; windowMs: number }): boolean {
  if (!opts.enabled) return false;
  if (!opts.lastCompletedRunAt) return false;
  return opts.now.getTime() - opts.lastCompletedRunAt.getTime() <= opts.windowMs;
}
