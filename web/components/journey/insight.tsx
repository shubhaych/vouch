export function Insight() {
  return (
    <section className="section journey-section journey-section--ink" id="insight" data-testid="insight">
      <p className="section__eyebrow section__eyebrow--on-ink">The insight</p>
      <p className="insight-line">
        Credit cards made credit scores essential.
        <br />
        AI shopping agents will make Vouch scores essential.
      </p>
      <p className="mt-6 max-w-2xl" style={{ color: "var(--ink-soft-dark)" }}>
        As buying on credit scaled between strangers, lenders needed a shared trust signal for people they had never met.
        That is the analogy — not a claim that cards literally invented modern scoring.
        As agents make purchases and refund requests easier to submit at scale, merchants face the same question:
        which claims can they trust?
      </p>

      <div className="vouch-reveal" data-testid="vouch-reveal">
        <div>
          <span className="feature__kicker feature__kicker--marigold">Reveal</span>
          <h2 className="section__title section__title--on-ink">
            Vouch is a portable refund reliability score.
          </h2>
          <p className="mt-3" style={{ color: "var(--ink-soft-dark)" }}>
            Built only from <strong style={{ color: "var(--ice)" }}>confirmed</strong> refund outcomes —
            not from an AI flag alone. A good score helps route credible claims faster.
            It does not override an invalid claim or the merchant’s policy.
          </p>
          <ul className="insight-bullets">
            <li>New customers show <em>No verified history</em> — not a punitive starter score.</li>
            <li>The score belongs to the verified purchaser and their confirmed outcomes, even when an agent submits.</li>
            <li>A flag sends a prepared case to the merchant; only the confirmed decision updates the score.</li>
          </ul>
        </div>
        <div className="score-card" aria-label="Example Vouch score card">
          <div className="score-card__top">
            <span className="panel-title">Vouch score</span>
            <span className="badge badge--fixture">Demo</span>
          </div>
          <div className="score-card__value">78</div>
          <div className="score-card__band">Strong · confirmed outcomes only</div>
          <div className="score-card__meta">
            <div>
              <span className="panel-title">First-time buyer</span>
              <div className="mt-1 text-sm" style={{ color: "var(--ice)" }}>No verified history</div>
            </div>
            <div>
              <span className="panel-title">After confirmed approve</span>
              <div className="mt-1 text-sm" style={{ color: "var(--marigold)" }}>Score begins from outcomes</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
