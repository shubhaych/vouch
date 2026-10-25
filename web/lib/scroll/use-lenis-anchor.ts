"use client";

import { useLenis } from "lenis/react";
import { useCallback } from "react";

/** Smooth-scroll to a page id via Lenis when available; native fallback otherwise. */
export function useLenisAnchor() {
  const lenis = useLenis();

  return useCallback(
    (id: string, offset = -24) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (lenis) {
        lenis.scrollTo(el, { offset, duration: 1.15 });
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [lenis],
  );
}

/** Parse `#id` or `/#id` hrefs for in-page navigation. */
export function hashIdFromHref(href: string): string | null {
  if (href.startsWith("#")) return href.slice(1) || null;
  if (href.startsWith("/#")) return href.slice(2) || null;
  return null;
}
