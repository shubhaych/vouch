const STEPS = [
  {
    title: "Video + spoken claim",
    detail: "Customer films the item and explains the issue. Evidence, not a confidence number.",
  },
  {
    title: "Order · shipping · policy",
    detail: "Merchant systems check what was ordered, delivered, and whether the request is in policy.",
  },
  {
    title: "Confirmed history",
    detail: "Prior confirmed outcomes — separate from whether this claim is valid.",
  },
  {
    title: "Approve or human review",
    detail: "Clear eligible claims move fast. Uncertain ones arrive as a prepared case for a person.",
  },
  {
    title: "Outcome updates Vouch",
    detail: "Only the confirmed merchant decision changes the portable score.",
  },
] as const;

export function HowItWorks() {
  return (
    <section className="section journey-section" id="how" data-testid="how-it-works">
      <p className="section__eyebrow">How Vouch works</p>
      <h2 className="section__title">One claim, five steps — evidence at every stage.</h2>
      <p className="mt-3 max-w-2xl text-ink-soft">
        Claim validity and customer history are separate inputs. For a shirt mismatch, the judge should see
        “Ordered: black, medium” beside “Observed: blue, small” — not a black-box score.
      </p>

      <ol className="flow-steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flow-step">
            <span className="flow-step__n">{String(i + 1).padStart(2, "0")}</span>
            <h3 className="flow-step__title">{s.title}</h3>
            <p className="flow-step__body">{s.detail}</p>
          </li>
        ))}
      </ol>

      <div className="evidence-example" data-testid="evidence-example">
        <div>
          <span className="panel-title" style={{ color: "var(--ink-soft)" }}>Ordered</span>
          <p className="evidence-example__line">Black T-shirt · Medium</p>
        </div>
        <div className="evidence-example__arrow" aria-hidden>
          →
        </div>
        <div>
          <span className="panel-title" style={{ color: "var(--ink-soft)" }}>Observed &amp; described</span>
          <p className="evidence-example__line evidence-example__line--flag">Blue T-shirt · Small</p>
        </div>
        <p className="evidence-example__note">
          Mismatch flags the case for the merchant with evidence attached. The flag alone never lowers the Vouch score.
        </p>
      </div>
    </section>
  );
}
