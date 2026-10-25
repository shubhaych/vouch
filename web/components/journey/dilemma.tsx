const STATS = [
  {
    value: "$103B",
    label: "Estimated U.S. retailer losses from fraudulent returns and claims",
    year: "2024",
    href: "https://apprissretail.com/news/appriss-retail-annual-research-fraudulent-returns-and-claims-cost-retailers-103b-in-2024/",
    source: "Appriss Retail / Deloitte",
  },
  {
    value: "76%",
    label: "of surveyed consumers more likely to choose a return option with instant refund or exchange",
    year: "2025",
    href: "https://nrf.com/media-center/press-releases/consumers-expected-to-return-nearly-850-billion-in-merchandise-in-2025",
    source: "NRF",
  },
  {
    value: "71%",
    label: "say a poor return experience makes them less likely to shop with that retailer again",
    year: "2025",
    href: "https://nrf.com/media-center/press-releases/consumers-expected-to-return-nearly-850-billion-in-merchandise-in-2025",
    source: "NRF",
  },
] as const;

export function Dilemma() {
  return (
    <section className="section journey-section" id="dilemma" data-testid="dilemma">
      <p className="section__eyebrow">The cost of getting refunds wrong</p>
      <h2 className="section__title">Merchants are trapped between abuse and delay.</h2>
      <p className="mt-3 max-w-2xl text-ink-soft">
        Approve too freely and absorb losses. Review every claim and make good customers wait.
        That dilemma is the business problem Vouch sells into.
      </p>

      <div className="stats-row" role="list">
        {STATS.map((s) => (
          <article key={s.value + s.label} className="stat-block" role="listitem">
            <div className="stat-block__value">{s.value}</div>
            <p className="stat-block__label">{s.label}</p>
            <a className="stat-block__source" href={s.href} target="_blank" rel="noreferrer">
              {s.source} · {s.year} ↗
            </a>
          </article>
        ))}
      </div>

      <div className="dilemma-editorial" aria-label="Merchant dilemma">
        <div className="dilemma-editorial__side">
          <p className="dilemma-editorial__kicker">Pressure A</p>
          <h3 className="dilemma-editorial__title">Approve too freely</h3>
          <p className="dilemma-editorial__body">
            Instant refunds feel great — until abuse and serial claims eat margin.
            Merchants absorb the bill for decisions made without reliable history.
          </p>
        </div>
        <div className="dilemma-editorial__rule" aria-hidden />
        <div className="dilemma-editorial__side">
          <p className="dilemma-editorial__kicker">Pressure B</p>
          <h3 className="dilemma-editorial__title">Review everything</h3>
          <p className="dilemma-editorial__body">
            Manual queues protect the store, but honest shoppers wait — and many never come back
            after a slow or opaque return.
          </p>
        </div>
      </div>
    </section>
  );
}
