import type { ReactNode } from "react";

/** Constructa's HUD frame: dark panel, cyan corner reticles, a live label, film grain. */
export function HudFrame({ children, label, right, className = "" }: { children: ReactNode; label?: string; right?: ReactNode; className?: string }) {
  return (
    <div className={`hud-frame ${className}`}>
      <span className="hud-frame__corner hud-frame__corner--tl" aria-hidden />
      <span className="hud-frame__corner hud-frame__corner--tr" aria-hidden />
      <span className="hud-frame__corner hud-frame__corner--bl" aria-hidden />
      <span className="hud-frame__corner hud-frame__corner--br" aria-hidden />
      {label || right ? (
        <div className="hud-frame__meta">
          {label ? (
            <span className="hud-frame__live">
              <span className="hud-frame__live-dot" aria-hidden />
              {label}
            </span>
          ) : <span />}
          {right}
        </div>
      ) : null}
      <div className="relative z-[1]">{children}</div>
      <div className="hud-frame__grain" aria-hidden />
    </div>
  );
}
