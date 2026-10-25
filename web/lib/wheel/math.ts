/** Pure geometry and easing for the 34-card claim wheel (rainbow-above-copy). */

export const CARD_COUNT = 34;
export const HIDE_DEG = 88;
/** Brisk deal — finishes before idle drift starts. */
export const ENTRANCE_DURATION = 1.55;
/** Calm baseline drift after the deal completes. */
export const DRIFT_DEG_PER_SEC = 5.5;
/**
 * Scroll→wheel coupling while the sticky hero is active.
 * Kept modest so Lenis page scroll is not fighting the cards.
 */
export const SCROLL_DEG_PER_PX = 0.11;

export interface WheelLayout {
  radius: number;
  pivotY: number;
  cardWidth: number;
  /** Half-arc cutoff (degrees from top) — tuned so edge cards stay fully on-screen. */
  hideDeg: number;
  tip: number;
  sceneScale: number;
  /** Viewport half-width used for bounds checks (px). */
  halfWidth: number;
}

export interface CardPose {
  angle: number;
  radius: number;
  pivotY: number;
  flipY: number;
  scale: number;
  depth: number;
  visible: boolean;
  dealProgress: number;
  fromTop: number;
}

export type CardTier = "focus" | "near" | "far";

/** Final seat on the full wheel — never remapped during entrance. */
export function homeAngle(i: number): number {
  return (i * 360) / CARD_COUNT;
}

export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function easeOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return 1 - (1 - x) ** 3;
}

export function easeEntrance(t: number): number {
  return sampleCubicBezier(clamp(t, 0, 1), 0.33, 0, 0.2, 1);
}

function sampleCubicBezier(x: number, x1: number, y1: number, x2: number, y2: number): number {
  let t = x;
  for (let i = 0; i < 6; i++) {
    const xt = cubic(t, x1, x2) - x;
    const dx = cubicDeriv(t, x1, x2);
    if (Math.abs(dx) < 1e-6) break;
    t = clamp(t - xt / dx, 0, 1);
  }
  return cubic(t, y1, y2);
}

function cubic(t: number, a: number, b: number): number {
  const u = 1 - t;
  return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
}

function cubicDeriv(t: number, a: number, b: number): number {
  const u = 1 - t;
  return 3 * u * u * a + 6 * u * t * (b - a) + 3 * t * t * (1 - b);
}

export function normalizeDelta(deg: number): number {
  let d = ((deg % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

/** Left→right stagger along the settled top arc (home angles only). */
const DEAL_RANK: number[] = (() => {
  const idxs = Array.from({ length: CARD_COUNT }, (_, i) => i);
  idxs.sort((a, b) => normalizeDelta(homeAngle(a)) - normalizeDelta(homeAngle(b)));
  const rank = new Array<number>(CARD_COUNT);
  idxs.forEach((slot, order) => {
    rank[slot] = order;
  });
  return rank;
})();

export function dealOrder(i: number): number {
  return DEAL_RANK[i] ?? i;
}

/**
 * Desktop: visible upper arc spans ~82–88% of hero width. Mobile keeps a tighter rainbow.
 * `width`/`height` are the full hero positioning area (not a cropped stage).
 */
export function layoutForFrame(width: number, height: number): WheelLayout {
  const mobile = width < 720;
  // Side margins so outermost visible cards stay fully on-screen (~7% each side → ~86% span).
  const margin = mobile ? 20 : Math.max(56, width * 0.07);
  const halfWidth = Math.max(160, width / 2 - margin);

  if (mobile) {
    const s = clamp(Math.min(width, height) / 420, 0.7, 1.05);
    const radius = clamp(height * 0.55, 160, 280);
    const cardWidth = clamp(100 * s, 84, 120);
    const maxSin = Math.min(0.98, (halfWidth - cardWidth * 0.55) / radius);
    const hideDeg = Math.min(70, (Math.asin(maxSin) * 180) / Math.PI - 2);
    return {
      radius,
      pivotY: 24 * s,
      cardWidth,
      hideDeg: Math.max(48, hideDeg),
      tip: 3,
      sceneScale: 1,
      halfWidth,
    };
  }

  const cardWidth = clamp(width * 0.1, 136, 168);
  const cardHalfH = (cardWidth * 16) / 9 / 2;
  // Wider half-arc so the fan reaches farther down the sides.
  const designTheta = 78;
  let radius = (halfWidth - cardWidth * 0.48) / Math.sin((designTheta * Math.PI) / 180);
  // CSS pivot ~90% — large radius, apex under nav, sides drop into the page.
  const pivotFrac = 0.9;
  const pivotY = height * 0.01;
  const maxRadius = height * pivotFrac + pivotY - cardHalfH - 10;
  radius = clamp(radius, 420, maxRadius);

  // Soft cutoff: cards stay in the DOM past the chord and fade via opacity.
  const maxSin = Math.min(0.995, (halfWidth - cardWidth * 0.35) / radius);
  const hideDeg = clamp((Math.asin(maxSin) * 180) / Math.PI + 4, 72, 98);

  return {
    radius,
    pivotY,
    cardWidth,
    hideDeg,
    tip: 2,
    sceneScale: 1,
    halfWidth,
  };
}

/** Edge fade — full opacity near the apex, dissolves toward the hidden half. */
export function cardOpacity(fromTop: number, hideDeg: number): number {
  const fadeStart = hideDeg * 0.38;
  if (fromTop <= fadeStart) return 1;
  const t = clamp((fromTop - fadeStart) / Math.max(1, hideDeg - fadeStart), 0, 1);
  return lerp(1, 0.06, easeOutCubic(t));
}

export function cardTier(fromTop: number): CardTier {
  if (fromTop < 12) return "focus";
  if (fromTop < 38) return "near";
  return "far";
}

/**
 * Entrance animates FROM a left-hand deck TO fixed home seats.
 * `wheelAngle` stays 0 until the deal finishes.
 */
export function cardPose(
  i: number,
  entranceT: number,
  wheelAngle: number,
  layout: WheelLayout,
): CardPose {
  const home = homeAngle(i);
  const order = dealOrder(i);
  const dealProgress = easeOutCubic(clamp((entranceT - order * 0.018) / 0.4, 0, 1));

  const stackAngle = -layout.hideDeg * 0.85;
  const angle = lerp(stackAngle, home, dealProgress) + wheelAngle;
  const radius = lerp(layout.radius * 0.92, layout.radius, dealProgress);
  const flipY = lerp(78, 0, dealProgress);
  const scale = lerp(0.88, 1, dealProgress);

  const fromTop = Math.abs(normalizeDelta(home + wheelAngle));
  const depth = -fromTop * 0.45;

  // Keep seats through the lower arc; opacity fades them out (no hard crop).
  const visible = dealProgress > 0.05 && fromTop <= layout.hideDeg;

  return {
    angle,
    radius,
    pivotY: layout.pivotY,
    flipY,
    scale,
    depth,
    visible,
    dealProgress,
    fromTop,
  };
}

export function poseTransform(p: CardPose): string {
  return [
    `translate3d(0, ${p.pivotY}px, ${p.depth}px)`,
    `rotateZ(${p.angle}deg)`,
    `translate3d(0, ${-p.radius}px, 0)`,
    `rotateY(${p.flipY}deg)`,
    `scale(${p.scale})`,
  ].join(" ");
}

export function promptExcerpt(prompt: string, tier: CardTier): string {
  const max = tier === "focus" ? 96 : tier === "near" ? 56 : 40;
  if (prompt.length <= max) return prompt;
  const cut = prompt.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 40 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}
