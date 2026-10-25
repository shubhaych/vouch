"use client";

import { useEffect, useRef, useState } from "react";
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
import { useLenisAnchor } from "@/lib/scroll/use-lenis-anchor";
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

export function HeroWheel({ embedded = false }: { embedded?: boolean }) {
  const reducedMotion = usePrefersReducedMotion();
  const { select } = useDemo();
  const scrollToId = useLenisAnchor();
  const [cards, setCards] = useState<PromptCard[]>(() => seededPromptCards(CARD_COUNT));
  const [dealDone, setDealDone] = useState(reducedMotion);
  const angleRef = useRef(0);
  const poolRef = useRef<PromptCard[]>(seededPromptCards(80));
  const poolIdx = useRef(34);
  const hostRef = useRef<HTMLElement | null>(null);
  const scrollDeltaRef = useRef(0);
  const lastScrollY = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void fetchPromptCards().then((rows) => {
      if (cancelled || rows.length < CARD_COUNT) return;
      setCards(rows);
      poolRef.current = seededPromptCards(80);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (cards.length < CARD_COUNT || !dealDone) return;
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
  }, [cards.length, dealDone]);

  // Bounded scroll→wheel while this sticky hero is on screen; ignored until deal ends.
  useEffect(() => {
    lastScrollY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - lastScrollY.current;
      lastScrollY.current = y;
      if (dy === 0 || reducedMotion || !dealDone) return;
      const host = hostRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) return;
      scrollDeltaRef.current -= dy * SCROLL_DEG_PER_PX;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [reducedMotion, dealDone]);

  const openCard = (card: PromptCard) => {
    if (card.demoClaimId) select(card.demoClaimId);
    scrollToId("demo");
  };

  const inner = (
    <section
      ref={(el) => {
        hostRef.current = el;
      }}
      className="hero-wheel"
      id="top"
      data-testid="journey-hero"
    >
      <div className="hero-wheel__stage-wrap">
        {cards.length >= CARD_COUNT ? (
          <ClaimWheel
            cards={cards}
            reducedMotion={reducedMotion}
            scrollDeltaRef={scrollDeltaRef}
            onDealComplete={() => setDealDone(true)}
            onOpenCard={openCard}
            onAngle={(a) => {
              angleRef.current = a;
            }}
          />
        ) : (
          <div className="hero-wheel__loading font-mono text-sm">Loading simulated prompts…</div>
        )}
      </div>

      <div className="hero-wheel__copy">
        <p className="hero-wheel__eyebrow">
          <span>Vouch</span>
          <span className="hero-wheel__eyebrow-rule" aria-hidden />
          <span>Refund trust for agent shopping</span>
        </p>
        <h1 className="hero-wheel__title">
          Agents can buy and claim at scale.
          <br />
          Merchants need a signal they can trust.
        </h1>
        <p className="hero-wheel__sub">
          Submit a video claim, see the investigation and decision, and watch the portable Vouch score update only from confirmed outcomes.
        </p>
        <div className="hero-wheel__cta-row">
          <a
            href="#demo"
            className="text-cta"
            data-testid="cta-see-demo"
            onClick={(e) => {
              e.preventDefault();
              scrollToId("demo");
            }}
          >
            Try a live refund claim
            <span aria-hidden> →</span>
          </a>
          <span className="hero-wheel__live">10,000 shopping agents · simulated activity</span>
        </div>
      </div>
    </section>
  );

  if (embedded) return inner;

  return (
    <div className="hero-track">
      <div className="hero-sticky">{inner}</div>
    </div>
  );
}
