"use client";

import { useRef, type RefObject } from "react";
import { useLenis } from "lenis/react";
import { useMotionValueEvent, type MotionValue } from "motion/react";

/**
 * Reading pauses inside a scroll-driven section. When the reader scrolls down
 * past a beat (a progress value 0..1 of the track), the page settles on it and
 * holds for `ms` before scrolling continues normally. Scrolling back above a
 * beat re-arms it. Without Lenis (reduced motion) there are no holds.
 */
export function useScrollHolds(trackRef: RefObject<HTMLElement | null>, progress: MotionValue<number>, beats: readonly number[], ms = 900) {
  const lenis = useLenis();
  const held = useRef(new Set<number>());
  const last = useRef(0);

  useMotionValueEvent(progress, "change", (p) => {
    const prev = last.current;
    last.current = p;
    for (const beat of beats) {
      if (p < beat - 0.02) held.current.delete(beat);
      if (!lenis || lenis.isStopped || held.current.has(beat) || !(prev < beat && p >= beat)) continue;
      held.current.add(beat);
      const el = trackRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const target = top + beat * (el.offsetHeight - window.innerHeight);
      lenis.scrollTo(target, { duration: 0.35, force: true });
      lenis.stop();
      window.setTimeout(() => lenis.start(), ms);
      return;
    }
  });
}
