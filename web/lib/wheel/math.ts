/** Pure geometry and easing for the 34-card claim wheel (rainbow-above-copy). */

export const CARD_COUNT = 34;
export const HIDE_DEG = 88;
export const ENTRANCE_DURATION = 2.0;
/** Idle drift — noticeable, still readable on the central card. */
export const DRIFT_DEG_PER_SEC = 2.15;
export const OPENING_TURN_DEG = 14;
/** Degrees of wheel travel per pixel of scroll while the sticky hero is active. */
export const SCROLL_DEG_PER_PX = 0.22;

export interface WheelLayout {
  radiusStart: number;
  radiusEnd: number;
  pivotStart: number;
  pivotEnd: number;
  cardWidth: number;
  hideDeg: number;
  sceneScaleStart: number;
  sceneScaleEnd: number;
  tipStart: number;
  tipEnd: number;
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

export function homeAngle(i: number): number {
  return (i * 360) / CARD_COUNT;
}

export function dealOrder(i: number): number {
  return Math.min(i, CARD_COUNT - i);
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
  return sampleCubicBezier(clamp(t, 0, 1), 0.45, 0, 0.15, 1);
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

/**
 * Geometry for a top-band rainbow: pivot sits low in the stage so the visible
 * arc bows upward above the headline.
 */
export function layoutForFrame(width: number, height: number): WheelLayout {
  const mobile = width < 720;
  const s = clamp(Math.min(width, height) / 480, 0.75, 1.15);
  return {
    radiusStart: (mobile ? 300 : 400) * s,
    radiusEnd: (mobile ? 400 : 540) * s,
    pivotStart: (mobile ? 40 : 56) * s,
    pivotEnd: (mobile ? 58 : 84) * s,
    cardWidth: (mobile ? 124 : 162) * s,
    hideDeg: mobile ? 68 : 96,
    sceneScaleStart: 0.98,
    sceneScaleEnd: 1.05,
    tipStart: 2,
    tipEnd: 5.5,
  };
}

export function cardTier(fromTop: number): CardTier {
  if (fromTop < 11) return "focus";
  if (fromTop < 36) return "near";
  return "far";
}

export function cardPose(
  i: number,
  entranceT: number,
  wheelAngle: number,
  layout: WheelLayout,
): CardPose {
  const home = homeAngle(i);
  const order = dealOrder(i);
  const dealProgress = easeOutCubic((entranceT - order * 0.032) / 0.28);

  const radius = lerp(layout.radiusStart, layout.radiusEnd, entranceT);
  const pivotY = lerp(layout.pivotStart, layout.pivotEnd, entranceT);
  const angle = home + wheelAngle + lerp(24, 0, dealProgress);
  const flipY = lerp(90, 0, dealProgress);
  const scale = lerp(0.92, 1, dealProgress);

  const fromTop = Math.abs(normalizeDelta(home + wheelAngle));
  const depth = -fromTop * 0.5;
  const visible = dealProgress > 0.08 && fromTop <= layout.hideDeg;

  return { angle, radius, pivotY, flipY, scale, depth, visible, dealProgress, fromTop };
}

export function sceneEntrance(entranceT: number, layout: WheelLayout): {
  rotateX: number;
  scale: number;
  opening: number;
} {
  return {
    rotateX: lerp(layout.tipStart, layout.tipEnd, entranceT),
    scale: lerp(layout.sceneScaleStart, layout.sceneScaleEnd, entranceT),
    opening: -OPENING_TURN_DEG * entranceT,
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
  const max = tier === "focus" ? 96 : tier === "near" ? 52 : 36;
  if (prompt.length <= max) return prompt;
  const cut = prompt.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 40 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}
