"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PromptCard } from "@/lib/demo/prompts";
import { formatPromptAmount } from "@/lib/demo/prompts";
import {
  CARD_COUNT,
  ENTRANCE_DURATION,
  DRIFT_DEG_PER_SEC,
  cardPose,
  cardTier,
  easeEntrance,
  layoutForFrame,
  poseTransform,
  promptExcerpt,
  sceneEntrance,
  type WheelLayout,
} from "@/lib/wheel/math";

interface Props {
  cards: PromptCard[];
  reducedMotion: boolean;
  skipToken: number;
  onEntranceProgress?: (t: number) => void;
  onReady?: () => void;
  onOpenCard: (card: PromptCard) => void;
  onAngle?: (angle: number) => void;
  /** Accumulated scroll→wheel degrees (same sign as idle). Cleared each frame. */
  scrollDeltaRef?: React.MutableRefObject<number>;
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
  skipToken,
  onEntranceProgress,
  onReady,
  onOpenCard,
  onAngle,
  scrollDeltaRef,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const layoutRef = useRef<WheelLayout>(layoutForFrame(1200, 520));
  const entranceRef = useRef(reducedMotion ? 1 : 0);
  const wheelRef = useRef(reducedMotion ? sceneEntrance(1, layoutRef.current).opening : 0);
  const targetRef = useRef(wheelRef.current);
  const velRef = useRef(0);
  const driftOnRef = useRef(reducedMotion);
  const pauseDriftRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const prevStyleRef = useRef<string[]>([]);
  const prevSceneRef = useRef("");
  const prevTierRef = useRef<string[]>([]);
  const readySent = useRef(false);
  const startRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const [layout, setLayout] = useState(() => layoutForFrame(1200, 520));

  const finishIntro = useCallback(() => {
    entranceRef.current = 1;
    driftOnRef.current = !reducedMotion;
    const scene = sceneEntrance(1, layoutRef.current);
    targetRef.current = scene.opening;
    wheelRef.current = scene.opening;
    onEntranceProgress?.(1);
  }, [onEntranceProgress, reducedMotion]);

  useEffect(() => {
    if (skipToken > 0) finishIntro();
  }, [skipToken, finishIntro]);

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
    const tick = (now: number) => {
      const dt = lastFrameRef.current == null ? 0.016 : Math.min(0.05, (now - lastFrameRef.current) / 1000);
      lastFrameRef.current = now;
      if (startRef.current == null) startRef.current = now;

      if (!reducedMotion && skipToken === 0 && entranceRef.current < 1) {
        const raw = Math.min(1, (now - startRef.current) / 1000 / ENTRANCE_DURATION);
        entranceRef.current = raw;
        onEntranceProgress?.(raw);
        if (raw >= 1) driftOnRef.current = true;
      }

      const L = layoutRef.current;
      const entranceT = easeEntrance(entranceRef.current);
      const scene = sceneEntrance(entranceT, L);

      if (!dragRef.current) {
        if (scrollDeltaRef && scrollDeltaRef.current !== 0) {
          targetRef.current += scrollDeltaRef.current;
          scrollDeltaRef.current = 0;
        }
        if (entranceRef.current < 1 && skipToken === 0 && !reducedMotion) {
          targetRef.current = scene.opening;
        } else if (driftOnRef.current && !reducedMotion && !pauseDriftRef.current) {
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

      const wheel = wheelRef.current;
      onAngle?.(wheel);

      for (let i = 0; i < CARD_COUNT; i++) {
        const pose = cardPose(i, entranceT, wheel, L);
        const tier = cardTier(pose.fromTop);
        const transform = poseTransform(pose);
        const visibility = pose.visible ? "visible" : "hidden";
        const key = `${transform}|${visibility}|${L.cardWidth}|${tier}`;
        if (prevStyleRef.current[i] === key) continue;
        prevStyleRef.current[i] = key;
        const node = cardRefs.current[i];
        if (!node) continue;
        node.style.transform = transform;
        node.style.visibility = visibility;
        node.style.width = `${L.cardWidth}px`;
        node.style.height = `${(L.cardWidth * 16) / 9}px`;
        if (prevTierRef.current[i] !== tier) {
          prevTierRef.current[i] = tier;
          node.dataset.tier = tier;
        }
        node.tabIndex = pose.visible && tier === "focus" ? 0 : -1;
      }

      const sceneKey = `${scene.rotateX.toFixed(3)}|${scene.scale.toFixed(4)}`;
      if (prevSceneRef.current !== sceneKey && stageRef.current) {
        prevSceneRef.current = sceneKey;
        stageRef.current.style.transform = `rotateX(${scene.rotateX}deg) scale(${scene.scale})`;
      }

      if (!readySent.current && entranceRef.current >= 1) {
        readySent.current = true;
        onReady?.();
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion, skipToken, onEntranceProgress, onReady, onAngle, scrollDeltaRef]);

  const pause = () => {
    pauseDriftRef.current = true;
  };
  const resume = () => {
    if (!dragRef.current) pauseDriftRef.current = false;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
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
    // Keep paused while pointer remains over the wheel (handled by leave).
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
