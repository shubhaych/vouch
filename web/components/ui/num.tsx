"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";
import { Badge, type Prov } from "./badge";

/** A number that tweens to its new value. Score changes always animate. */
export function Tween({ value, format = (n) => Math.round(n).toLocaleString("en-US"), duration = 0.8 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) { setShown(value); from.current = value; return; }
    const ctrl = animate(from.current, value, { duration, ease: "easeOut", onUpdate: (v) => setShown(v) });
    from.current = value;
    return () => ctrl.stop();
  }, [value, duration, reduce]);
  return <span className="tabular-nums">{format(shown)}</span>;
}

/** A labelled number with its provenance badge. */
export function Stat({ label, value, prov, format, sub, testId }: { label: string; value: number | null; prov: Prov; format?: (n: number) => string; sub?: string; testId?: string }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase tracking-wider opacity-70">
        <span className="truncate">{label}</span>
        <Badge kind={prov} />
      </div>
      <div className="mt-1 text-2xl font-bold tracking-tight">
        {value === null ? <span className="skeleton inline-block h-6 w-16 align-middle" /> : <Tween value={value} format={format} />}
      </div>
      {sub ? <div className="mt-0.5 text-xs opacity-60">{sub}</div> : null}
    </div>
  );
}
