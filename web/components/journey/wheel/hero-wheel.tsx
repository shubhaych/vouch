"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchPromptCards,
  seededPromptCards,
  type PromptCard,
} from "@/lib/demo/prompts";
import { useDemo } from "@/lib/demo/demo-store";
import {
  CARD_COUNT,
  HIDE_DEG,
  SCROLL_DEG_PER_PX,
  homeAngle,
  normalizeDelta,
} from "@/lib/wheel/math";
import { ClaimWheel } from "./claim-wheel";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function HeroWheel() {
  const reducedMotion = usePrefersReducedMotion();
  const { select } = useDemo();
  const [cards, setCards] = useState<PromptCard[]>([]);
  const [skipToken, setSkipToken] = useState(0);
  const [introDone, setIntroDone] = useState(reducedMotion);
  const angleRef = useRef(0);
  const poolRef = useRef<PromptCard[]>([]);
  const poolIdx = useRef(34);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollDeltaRef = useRef(0);
  const lastScrollY = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void fetchPromptCards().then((rows) => {
      if (cancelled) return;
      setCards(rows);
      poolRef.current = seededPromptCards(80);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (cards.length < CARD_COUNT) return;
    const id = window.setInterval(() => {
      const wheel = angleRef.current;
      setCards((prev) => {
        const next = prev.slice();
        let changed = false;
        for (let i = 0; i < CARD_COUNT; i++) {
          const fromTop = Math.abs(normalizeDelta(homeAngle(i) + wheel));
          if (fromTop <= HIDE_DEG) continue;
          const fresh = poolRef.current[poolIdx.current % poolRef.current.length];
          poolIdx.current += 1;
          if (!fresh) continue;
          next[i] = { ...fresh, id: prev[i]!.id };
          changed = true;
        }
        return changed ? next : prev;
      });
    }, 4200);
    return () => window.clearInterval(id);
  }, [cards.length]);

  const skip = useCallback(() => {
    setSkipToken((n) => n + 1);
    setIntroDone(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !introDone) skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [introDone, skip]);

  // Scroll-position deltas drive the rainbow while the sticky hero is on screen.
  useEffect(() => {
    lastScrollY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - lastScrollY.current;
      lastScrollY.current = y;
      if (dy === 0 || reducedMotion) return;
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      // Active while any part of the sticky track occupies the viewport.
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) return;
      // Same direction as idle drift (negative degrees as the page moves down).
      scrollDeltaRef.current -= dy * SCROLL_DEG_PER_PX;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [reducedMotion]);

  const openCard = (card: PromptCard) => {
    if (card.demoClaimId) select(card.demoClaimId);
    document.getElementById("demo")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="hero-track" ref={trackRef}>
      <div className="hero-sticky">
        <section className="hero-wheel" id="top" data-testid="journey-hero">
          <div className="hero-wheel__wisps" aria-hidden>
            <span className="hero-wheel__wisp hero-wheel__wisp--a" />
            <span className="hero-wheel__wisp hero-wheel__wisp--b" />
          </div>

          {/* Rainbow arc first — highest card near top center. */}
          <div className="hero-wheel__stage-wrap">
            {cards.length >= 34 ? (
              <ClaimWheel
                cards={cards}
                reducedMotion={reducedMotion}
                skipToken={skipToken}
                scrollDeltaRef={scrollDeltaRef}
                onReady={() => setIntroDone(true)}
                onOpenCard={openCard}
                onAngle={(a) => {
                  angleRef.current = a;
                }}
              />
            ) : (
              <div className="hero-wheel__loading font-mono text-sm">Loading simulated prompts…</div>
            )}
          </div>

          {/* Copy in the clear space under the arc. */}
          <div className="hero-wheel__copy">
            <p className="hero-wheel__eyebrow">
              <span>Vouch</span>
              <span className="hero-wheel__eyebrow-rule" aria-hidden />
              <span>Trust for agentic commerce</span>
            </p>
            <h1 className="hero-wheel__title">
              When every shopper has an agent,
              <br />
              every refund becomes a prompt.
            </h1>
            <p className="hero-wheel__sub">
              Vouch gives merchants the evidence and trust history to resolve credible claims fast.
            </p>
            <div className="hero-wheel__cta-row">
              <a href="#demo" className="text-cta" data-testid="cta-see-demo">
                Watch a claim move through Vouch
                <span aria-hidden> →</span>
              </a>
              <span className="hero-wheel__live">10,000 shopping agents · simulated activity</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
