"use client";

import { useRef } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";

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

/** Non-overlapping beats: each number fully clears before the next enters. */
const STAT_RANGES = [
  [0.1, 0.32] as const,
  [0.34, 0.56] as const,
  [0.58, 0.78] as const,
] as const;

/** After the last figure exits (~0.78), title + pressures enter as one screen. */
const FINALE_IN = 0.82;
const FINALE_SETTLE = 0.9;

export function Dilemma() {
  const reduced = useReducedMotion();
  if (reduced) return <DilemmaStatic />;
  return <DilemmaScroll />;
}

function DilemmaIntro() {
  return (
    <>
      <p className="section__eyebrow">The cost of getting refunds wrong</p>
      <h2 className="section__title dilemma-intro__title">
        Merchants are trapped between abuse and delay.
      </h2>
      <p className="dilemma-intro__lede">
        Approve too freely and absorb losses. Review every claim and make good customers wait.
        That dilemma is the business problem Vouch sells into.
      </p>
    </>
  );
}

function Pressures() {
  return (
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
  );
}

function DilemmaStatic() {
  return (
    <section className="section journey-section" id="dilemma" data-testid="dilemma">
      <DilemmaIntro />
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
      <Pressures />
    </section>
  );
}

function DilemmaScroll() {
  const trackRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ["start start", "end end"],
  });

  // Intro shows first, then fully yields so numbers own the stage alone.
  const headlineOpacity = useTransform(scrollYProgress, [0, 0.03, 0.1, 0.16], [0, 1, 1, 0]);
  const headlineY = useTransform(scrollYProgress, [0, 0.08], [20, 0]);

  // After the last number exits, title + description return above the two pressures.
  const finaleOpacity = useTransform(
    scrollYProgress,
    [FINALE_IN, FINALE_SETTLE],
    [0, 1],
  );
  const finaleY = useTransform(scrollYProgress, [FINALE_IN, FINALE_SETTLE], [28, 0]);

  return (
    <section ref={trackRef} className="dilemma-track" id="dilemma" data-testid="dilemma">
      <div className="dilemma-sticky">
        <div className="dilemma-sticky__inner">
          <motion.div className="dilemma-intro" style={{ opacity: headlineOpacity, y: headlineY }}>
            <DilemmaIntro />
          </motion.div>

          <div className="dilemma-stat-stage" role="list">
            {STATS.map((s, i) => (
              <StatReveal
                key={s.value + s.label}
                stat={s}
                progress={scrollYProgress}
                range={STAT_RANGES[i]!}
              />
            ))}
          </div>

          <motion.div
            className="dilemma-finale"
            style={{ opacity: finaleOpacity, y: finaleY }}
            data-testid="dilemma-finale"
          >
            <div className="dilemma-finale__intro">
              <DilemmaIntro />
            </div>
            <Pressures />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function StatReveal({
  stat,
  progress,
  range,
}: {
  stat: (typeof STATS)[number];
  progress: MotionValue<number>;
  range: readonly [number, number];
}) {
  const [a, b] = range;
  const span = b - a;
  const settle = a + span * 0.45;
  const holdEnd = a + span * 0.72;
  const exit = b;

  const opacity = useTransform(progress, [a, a + span * 0.1, holdEnd, exit], [0, 1, 1, 0]);
  const scale = useTransform(progress, [a, settle, holdEnd], [2.8, 1.08, 1]);
  const y = useTransform(progress, [a, settle], [48, 0]);
  const metaOpacity = useTransform(
    progress,
    [settle, settle + span * 0.15, holdEnd, exit],
    [0, 1, 1, 0],
  );

  return (
    <motion.article className="dilemma-stat" role="listitem" style={{ opacity }}>
      <motion.div className="dilemma-stat__value-wrap" style={{ scale, y }}>
        <div className="dilemma-stat__value">{stat.value}</div>
      </motion.div>
      <motion.div className="dilemma-stat__meta" style={{ opacity: metaOpacity }}>
        <p className="dilemma-stat__label">{stat.label}</p>
        <a className="dilemma-stat__source" href={stat.href} target="_blank" rel="noreferrer">
          {stat.source} · {stat.year} ↗
        </a>
      </motion.div>
    </motion.article>
  );
}
