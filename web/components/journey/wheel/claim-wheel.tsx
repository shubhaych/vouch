"use client";

import { useEffect, useRef, useState } from "react";
import type { PromptCard } from "@/lib/demo/prompts";
import { formatPromptAmount } from "@/lib/demo/prompts";
import {
  CARD_COUNT,
  ENTRANCE_DURATION,
  DRIFT_DEG_PER_SEC,
  cardOpacity,
  cardPose,
  cardTier,
  easeEntrance,
  layoutForFrame,
  poseTransform,
  promptExcerpt,
  type WheelLayout,
} from "@/lib/wheel/math";

interface Props {
  cards: PromptCard[];
  reducedMotion: boolean;
  onOpenCard: (card: PromptCard) => void;
  onAngle?: (angle: number) => void;
  /** Accumulated scroll→wheel degrees. Cleared each frame. Ignored during deal. */
  scrollDeltaRef?: React.MutableRefObject<number>;
  /** Fired once when the deal finishes and drift may begin. */
  onDealComplete?: () => void;
}

interface DragState {
  pointerId: number;
  lastX: number;
  lastT: number;
  moved: boolean;
  pauseAt: number;
}

export function ClaimWheel({
  cards,
  reducedMotion,
  onOpenCard,
  onAngle,
  scrollDeltaRef,
  onDealComplete,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const layoutRef = useRef<WheelLayout>(layoutForFrame(1200, 520));
  const entranceRef = useRef(reducedMotion ? 1 : 0);
  const wheelRef = useRef(0);
  const targetRef = useRef(0);
  const velRef = useRef(0);
  const driftOnRef = useRef(false);
  const pauseDriftRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const prevStyleRef = useRef<string[]>([]);
  const prevTierRef = useRef<string[]>([]);
  const dealDoneRef = useRef(reducedMotion);
  const startRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const [layout, setLayout] = useState(() => layoutForFrame(1200, 520));

  useEffect(() => {
    if (!reducedMotion) return;
    entranceRef.current = 1;
    driftOnRef.current = false;
    wheelRef.current = 0;
    targetRef.current = 0;
    if (!dealDoneRef.current) {
      dealDoneRef.current = true;
      onDealComplete?.();
    }
  }, [reducedMotion, onDealComplete]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = layoutForFrame(r.width, Math.max(r.height, 360));
      layoutRef.current = next;
      setLayout(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    const tip = layoutRef.current.tip;
    const scale = layoutRef.current.sceneScale;
    if (stageRef.current) {
      stageRef.current.style.transform = `rotateX(${tip}deg) scale(${scale})`;
    }

    const tick = (now: number) => {
      const dt = lastFrameRef.current == null ? 0.016 : Math.min(0.05, (now - lastFrameRef.current) / 1000);
      lastFrameRef.current = now;
      if (startRef.current == null) startRef.current = now;

      const dealing = !reducedMotion && entranceRef.current < 1;
      if (dealing) {
        entranceRef.current = Math.min(1, (now - startRef.current) / 1000 / ENTRANCE_DURATION);
      }

      const L = layoutRef.current;
      const entranceT = reducedMotion ? 1 : easeEntrance(entranceRef.current);

      if (!dragRef.current) {
        if (dealing) {
          // Lock wheel geometry during the deal — discard scroll deltas.
          if (scrollDeltaRef) scrollDeltaRef.current = 0;
          targetRef.current = 0;
          wheelRef.current = 0;
          velRef.current = 0;
        } else {
          if (!dealDoneRef.current) {
            dealDoneRef.current = true;
            driftOnRef.current = !reducedMotion;
            onDealComplete?.();
          }
          if (scrollDeltaRef && scrollDeltaRef.current !== 0) {
            targetRef.current += scrollDeltaRef.current;
            scrollDeltaRef.current = 0;
          }
          if (driftOnRef.current && !reducedMotion && !pauseDriftRef.current) {
            targetRef.current -= DRIFT_DEG_PER_SEC * dt;
          }
          if (Math.abs(velRef.current) > 0.02) {
            targetRef.current += velRef.current * dt;
            velRef.current *= Math.exp(-dt * 3.2);
            if (Math.abs(velRef.current) < 0.02) velRef.current = 0;
          }
          const k = 1 - Math.exp(-dt * 9);
          wheelRef.current += (targetRef.current - wheelRef.current) * k;
        }
      }

      const wheel = wheelRef.current;
      onAngle?.(wheel);

      for (let i = 0; i < CARD_COUNT; i++) {
        const pose = cardPose(i, entranceT, wheel, L);
        const tier = cardTier(pose.fromTop);
        const opacity = pose.visible ? cardOpacity(pose.fromTop, L.hideDeg) : 0;
        const transform = poseTransform(pose);
        const visibility = pose.visible && opacity > 0.04 ? "visible" : "hidden";
        const key = `${transform}|${visibility}|${L.cardWidth}|${tier}|${opacity.toFixed(2)}`;
        if (prevStyleRef.current[i] === key) continue;
        prevStyleRef.current[i] = key;
        const node = cardRefs.current[i];
        if (!node) continue;
        node.style.transform = transform;
        node.style.visibility = visibility;
        node.style.opacity = String(opacity);
        node.style.width = `${L.cardWidth}px`;
        node.style.height = `${(L.cardWidth * 16) / 9}px`;
        if (prevTierRef.current[i] !== tier) {
          prevTierRef.current[i] = tier;
          node.dataset.tier = tier;
        }
        node.tabIndex = pose.visible && tier === "focus" ? 0 : -1;
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion, onAngle, scrollDeltaRef, onDealComplete]);

  const pause = () => {
    pauseDriftRef.current = true;
  };
  const resume = () => {
    if (!dragRef.current) pauseDriftRef.current = false;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (entranceRef.current < 1 && !reducedMotion) return;
    rootRef.current?.setPointerCapture(e.pointerId);
    pauseDriftRef.current = true;
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: e.pointerId,
      lastX: e.clientX,
      lastT: performance.now(),
      moved: false,
      pauseAt: performance.now(),
    };
    velRef.current = 0;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const now = performance.now();
    const dx = e.clientX - d.lastX;
    if (Math.abs(dx) > 3) {
      d.moved = true;
      suppressClickRef.current = true;
    }
    if (Math.abs(dx) >= 0.5) d.pauseAt = now;
    const dt = Math.max(0.008, (now - d.lastT) / 1000);
    const deg = (dx / Math.max(layout.cardWidth, 1)) * 22;
    wheelRef.current += deg;
    targetRef.current = wheelRef.current;
    velRef.current = deg / dt;
    d.lastX = e.clientX;
    d.lastT = now;
  };

  const endDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (performance.now() - d.pauseAt > 80) velRef.current = 0;
    dragRef.current = null;
  };

  const slots = cards.slice(0, CARD_COUNT);
  const setCardRef = (i: number) => (el: HTMLButtonElement | null) => {
    cardRefs.current[i] = el;
  };

  return (
    <div
      ref={rootRef}
      className="claim-wheel"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerEnter={pause}
      onPointerLeave={resume}
      onFocusCapture={pause}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume();
      }}
      role="list"
      aria-label="Incoming refund prompts from simulated shopping agents"
    >
      <div ref={stageRef} className="claim-wheel__stage">
        <div className="claim-wheel__pivot">
          {slots.map((card, i) => (
            <button
              key={card.id}
              ref={setCardRef(i)}
              type="button"
              className="prompt-card"
              role="listitem"
              tabIndex={-1}
              data-tier="far"
              aria-label={`Incoming claim from agent ${card.agentId}: ${card.prompt}`}
              data-testid={`prompt-card-${card.id}`}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                onOpenCard(card);
              }}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                marginLeft: layout.cardWidth / -2,
                marginTop: (layout.cardWidth * 16) / 9 / -2,
                width: layout.cardWidth,
                height: (layout.cardWidth * 16) / 9,
                transformStyle: "preserve-3d",
              }}
            >
              <span className="prompt-card__face prompt-card__face--back" aria-hidden>
                <span className="prompt-card__mono">V</span>
                <span className="prompt-card__back-label">Incoming claim</span>
              </span>
              <span className="prompt-card__face prompt-card__face--front">
                <span className="prompt-card__meta">
                  <span>{card.agentId}</span>
                  <span>{card.timeLabel}</span>
                </span>
                <span className="prompt-card__merchant">{card.merchant}</span>
                <span className="prompt-card__order">Order {card.orderNumber}</span>
                <span className="prompt-card__amount">{formatPromptAmount(card.amountCents)}</span>
                <span className="prompt-card__prompt prompt-card__prompt--focus">
                  {promptExcerpt(card.prompt, "focus")}
                </span>
                <span className="prompt-card__prompt prompt-card__prompt--near" aria-hidden>
                  {promptExcerpt(card.prompt, "near")}
                </span>
                <span className="prompt-card__prompt prompt-card__prompt--far" aria-hidden>
                  {promptExcerpt(card.prompt, "far")}
                </span>
                <span className="prompt-card__prov">Simulated · agent prompt</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
