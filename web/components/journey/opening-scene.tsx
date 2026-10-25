"use client";

import { useRef } from "react";
import {
  motion,
  useMotionTemplate,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import { HeroWheel } from "./wheel/hero-wheel";
import { ParcelMoment } from "./parcel-moment";

/**
 * One continuous room plate behind the hero + parcel beat.
 * Ice-silver veil softens the pale upper wall; scrolling reveals the table.
 * Hero ~150vh, room ~185vh — no hard seam behind the CTA.
 */
export function OpeningScene() {
  const trackRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ["start start", "end end"],
  });

  const bgY = useTransform(scrollYProgress, [0, 0.4, 0.72, 1], [20, 36, 56, 62]);
  const objectPosition = useMotionTemplate`48% ${bgY}%`;
  const veilOpacity = useTransform(
    scrollYProgress,
    [0, 0.16, 0.38, 0.52],
    reduced ? [0.32, 0.18, 0.06, 0] : [0.58, 0.4, 0.12, 0],
  );
  // Parcel beat uses the latter portion of the same progress (mapped inside ParcelMoment).

  return (
    <div className="opening" ref={trackRef} data-testid="opening-scene">
      <div className="opening__plate" aria-hidden>
        <motion.img
          className="opening__bg"
          src="/images/vouch-room-table-background-v3.jpg"
          alt=""
          decoding="async"
          fetchPriority="high"
          style={{ objectPosition }}
        />
        <motion.div className="opening__veil" style={{ opacity: veilOpacity }} />
      </div>

      <div className="opening__layers">
        <div className="opening__hero-run">
          <div className="opening__hero-sticky">
            <HeroWheel embedded />
          </div>
        </div>
        <div className="opening__room-run" id="arrival">
          <div className="opening__room-sticky">
            <ParcelMoment scrollYProgress={scrollYProgress} reduced={!!reduced} />
          </div>
        </div>
      </div>
    </div>
  );
}
