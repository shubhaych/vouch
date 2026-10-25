"use client";

import Link from "next/link";
import { useDemo } from "@/lib/demo/demo-store";

/** Next chapters after the phone claim: live merchant result → network → simulation. */
export function JudgeNext() {
  const { liveMerchantClaimId } = useDemo();
  const merchantHref = liveMerchantClaimId
    ? `/merchant/claim/${liveMerchantClaimId}`
    : null;

  return (
    <section
      className="section journey-section journey-section--compact"
      id="next"
      data-testid="judge-next"
    >
      <p className="section__eyebrow">Next chapter</p>
      <h2 className="section__title">After the claim, follow the story.</h2>
      <p className="chapter-path__lede">
        The live merchant result is the primary destination once a phone claim is submitted. Then widen
        out to the company network and the simulation at scale.
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
            <div className="chapter-path__link chapter-path__link--waiting" data-testid="chapter-merchant-waiting">
              <span className="chapter-path__n">01</span>
              <span className="chapter-path__body">
                <span className="chapter-path__label">Merchant result</span>
                <span className="chapter-path__detail">
                  Opens automatically after you submit from the phone (or this device). That live case
                  is the primary destination — not a fixture.
                </span>
              </span>
            </div>
          )}
        </li>

        <li className="chapter-path__item">
          <Link href="/network" className="chapter-path__link" data-testid="chapter-network">
            <span className="chapter-path__n">02</span>
            <span className="chapter-path__body">
              <span className="chapter-path__label">Company network</span>
              <span className="chapter-path__detail">
                100 merchants with products and policies — portable history without raw videos.
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
            /business
          </Link>
          <span aria-hidden>·</span>
          <Link href="/shop" className="chapter-path__secondary-link">
            /shop
          </Link>
          <span aria-hidden>·</span>
          <Link href="/world" className="chapter-path__secondary-link">
            /world
          </Link>
        </p>
      </div>
    </section>
  );
}
