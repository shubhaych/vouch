"use client";

import { motion, useReducedMotion } from "motion/react";

const CREDIT_PATH = [
  { label: "Credit expands", detail: "Lending moves beyond people who already know each other." },
  { label: "Lenders need a signal", detail: "A portable trust history they can share across institutions." },
  { label: "Confirmed outcomes", detail: "Decisions rest on verified repayment history — not a one-off guess." },
] as const;

const AGENT_PATH = [
  { label: "Agents shop & refund", detail: "Purchases and claims become easy to submit at scale." },
  { label: "Merchants need a signal", detail: "They cannot manually assess every refund request." },
  { label: "Verified refund history", detail: "A portable reliability signal — across merchants, for refunds." },
] as const;

/**
 * Credit ↔ agent-commerce analogy on the ice-silver home palette.
 * Quiet copy only for the credit-score / creditworthiness qualifications.
 */
export function Insight() {
  const reduced = useReducedMotion();

  return (
    <section
      className="section journey-section insight-compare"
      id="insight"
      data-testid="insight"
    >
      <p className="section__eyebrow">The insight</p>
      <h2 className="insight-compare__headline">
        When trust has to travel, you need a portable signal.
      </h2>
      <p className="insight-compare__quiet">
        Same structure, different market. Credit cards did not invent scoring — and Vouch does not
        measure creditworthiness. It measures confirmed refund outcomes.
      </p>

      <div className="insight-compare__grid" data-testid="insight-era">
        <PathColumn
          kicker="Credit era"
          title="Credit expands"
          subtitle="Lenders need a portable trust signal."
          steps={CREDIT_PATH}
          reduced={!!reduced}
          delay={0}
        />
        <div className="insight-compare__rule" aria-hidden />
        <PathColumn
          kicker="Agent shopping era"
          title="Agents buy and claim"
          subtitle="Merchants need a portable refund reliability signal."
          steps={AGENT_PATH}
          reduced={!!reduced}
          delay={0.08}
        />
      </div>

      <motion.div
        className="insight-compare__converge"
        initial={reduced ? false : { opacity: 0, y: 10 }}
        whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-10%" }}
        transition={{ duration: 0.45, delay: 0.12 }}
      >
        <span className="insight-compare__converge-line" aria-hidden />
        <p className="insight-compare__converge-label">Both paths lead to</p>
        <p className="insight-compare__converge-brand">Vouch</p>
      </motion.div>

      <VouchReveal reduced={!!reduced} />
    </section>
  );
}

function PathColumn({
  kicker,
  title,
  subtitle,
  steps,
  reduced,
  delay,
}: {
  kicker: string;
  title: string;
  subtitle: string;
  steps: readonly { label: string; detail: string }[];
  reduced: boolean;
  delay: number;
}) {
  return (
    <motion.div
      className="insight-path"
      initial={reduced ? false : { opacity: 0, y: 14 }}
      whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-8%" }}
      transition={{ duration: 0.45, delay }}
    >
      <p className="insight-path__kicker">{kicker}</p>
      <h3 className="insight-path__title">{title}</h3>
      <p className="insight-path__subtitle">{subtitle}</p>
      <ol className="insight-path__steps">
        {steps.map((s, i) => (
          <li key={s.label} className="insight-path__step">
            <span className="insight-path__n">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <span className="insight-path__label">{s.label}</span>
              <span className="insight-path__detail">{s.detail}</span>
            </div>
          </li>
        ))}
      </ol>
    </motion.div>
  );
}

function VouchReveal({ reduced }: { reduced: boolean }) {
  return (
    <motion.div
      className="vouch-reveal"
      data-testid="vouch-reveal"
      initial={reduced ? false : { opacity: 0, y: 12 }}
      whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10%" }}
      transition={{ duration: 0.45, delay: 0.16 }}
    >
      <div>
        <span className="feature__kicker feature__kicker--marigold">What Vouch is</span>
        <h3 className="section__title">A portable refund reliability signal.</h3>
        <p className="vouch-reveal__lede">
          Built only from <strong>confirmed</strong> refund outcomes across merchants — not from an
          AI flag alone.
        </p>
        <ul className="insight-bullets">
          <li>An AI flag routes a claim to human review. It does not lower the score by itself.</li>
          <li>Only a confirmed merchant decision updates the portable history.</li>
          <li>
            New customers show <em>No verified history</em> — not a punitive starter score.
          </li>
        </ul>
      </div>
      <div className="score-card" aria-label="Example Vouch score card">
        <div className="score-card__top">
          <span className="panel-title">Vouch score</span>
          <span className="badge badge--fixture">Demo</span>
        </div>
        <div className="score-card__value">78</div>
        <div className="score-card__band">Strong · confirmed outcomes only</div>
        <div className="score-card__flag">
          <span className="panel-title">AI flag</span>
          <div className="score-card__flag-line">Mismatch → human review</div>
          <div className="score-card__flag-note">Score unchanged until confirmed</div>
        </div>
      </div>
    </motion.div>
  );
}
