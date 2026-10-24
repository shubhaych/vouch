"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

type Tone = "honest" | "fraud" | "review" | "accent";
interface Toast { id: number; text: string; tone: Tone }

let next = 1;
const listeners = new Set<(t: Toast) => void>();

/** Fire-and-forget notifications (reducer errors, decisions, journal entries). */
export function toast(text: string, tone: Tone = "accent") {
  const t = { id: next++, text, tone };
  for (const l of listeners) l(t);
}

const BORDER: Record<Tone, string> = {
  honest: "border-honest/60", fraud: "border-fraud/60", review: "border-review/60", accent: "border-accent/60",
};

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (t: Toast) => {
      setItems((xs) => [...xs.slice(-3), t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 6000);
    };
    listeners.add(on);
    return () => { listeners.delete(on); };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-2" data-testid="toaster">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            className={`glass pointer-events-auto border-l-4 px-4 py-3 text-sm ${BORDER[t.tone]}`}
            role="status"
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
