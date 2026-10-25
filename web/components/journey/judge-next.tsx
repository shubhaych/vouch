"use client";

import Link from "next/link";
import { useDemo } from "@/lib/demo/demo-store";

/** Next chapters after the phone claim: live merchant result → network → simulation. */
export function JudgeNext() {
  const { liveMerchantClaimId } = useDemo();
  const merchantHref = liveMerchantClaimId
    ? `/business?claim=${liveMerchantClaimId}`
    : null;

  return (
    <section
      className="section journey-section journey-section--compact"
      id="next"
      data-testid="judge-next"
    >
      <p className="section__eyebrow">Where to go next</p>
      <h2 className="section__title">See the merchant case, then the shops, then the economy at scale.</h2>
      <p className="chapter-path__lede">
        Open the merchant case for your claim. Then browse the 100 simulated shops, or open the
        10,000-agent simulation.
      </p>

      <ol className="chapter-path">
        <li className="chapter-path__item chapter-path__item--primary">
          {merchantHref ? (
            <Link href={merchantHref} className="chapter-path__link" data-testid="chapter-merchant-live">
              <span className="chapter-path__n">01</span>
              <span className="chapter-path__body">
                <span className="chapter-path__label">
                  Merchant result <span className="badge badge--live">Live</span>
                </span>
                <span className="chapter-path__detail">
                  Your submitted claim: product, video, policy, history, and recommendation.
                </span>
              </span>
              <span className="chapter-path__arrow" aria-hidden>
                →
              </span>
            </Link>
          ) : (
            <Link href="/business" className="chapter-path__link" data-testid="chapter-merchant-waiting">
              <span className="chapter-path__n">01</span>
              <span className="chapter-path__body">
                <span className="chapter-path__label">
                  Merchant result <span className="badge badge--fixture">Preview</span>
                </span>
                <span className="chapter-path__detail">
                  See what the merchant gets for a claim. After you submit from the phone, this opens your live case instead.
                </span>
              </span>
              <span className="chapter-path__arrow" aria-hidden>
                →
              </span>
            </Link>
          )}
        </li>

        <li className="chapter-path__item">
          <Link href="/shop" className="chapter-path__link" data-testid="chapter-network">
            <span className="chapter-path__n">02</span>
            <span className="chapter-path__body">
              <span className="chapter-path__label">Partner shops</span>
              <span className="chapter-path__detail">
                100 simulated merchants. Buy or open a return with the same phone flow.
              </span>
            </span>
            <span className="chapter-path__arrow" aria-hidden>
              →
            </span>
          </Link>
        </li>

        <li className="chapter-path__item">
          <Link href="/simulation" className="chapter-path__link" data-testid="chapter-simulation">
            <span className="chapter-path__n">03</span>
            <span className="chapter-path__body">
              <span className="chapter-path__label">Simulation at scale</span>
              <span className="chapter-path__detail">
                10,000 simulated agents shopping and building Vouch histories.
              </span>
            </span>
            <span className="chapter-path__arrow" aria-hidden>
              →
            </span>
          </Link>
        </li>
      </ol>

      <div className="chapter-path__secondary">
        <p className="chapter-path__secondary-label">Also available</p>
        <p className="chapter-path__secondary-links">
          <Link href="/merchant/claim/fixture" className="chapter-path__secondary-link">
            Fixture merchant preview
          </Link>
          <span aria-hidden>·</span>
          <Link href="/business" className="chapter-path__secondary-link">
            Business desk
          </Link>
          <span aria-hidden>·</span>
          <Link href="/world" className="chapter-path__secondary-link">
            World globe
          </Link>
        </p>
      </div>
    </section>
  );
}
