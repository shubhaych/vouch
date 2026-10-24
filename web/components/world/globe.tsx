"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import { BANDS, BAND_COLOR, type AgentPoint, type Arc, type Band, type Ring } from "./use-world";

const ReactGlobe = dynamic(() => import("react-globe.gl"), { ssr: false, loading: () => <div className="skeleton absolute inset-0 rounded-none" /> });

export interface BusinessPoint { id: number; lat: number; lng: number; name: string; category: string; size: number; dim?: boolean }
export interface HexPoint { lat: number; lng: number; weight: number; score?: number }
export interface Pov { lat: number; lng: number; altitude: number }

interface Props {
  byBand: Record<Band, AgentPoint[]>;
  live: AgentPoint[];
  /** Replay: everything not in the pattern dims to 15%. */
  dimmed?: AgentPoint[] | null;
  highlight?: AgentPoint[] | null;
  selected: AgentPoint | null;
  businesses: BusinessPoint[];
  arcs: Arc[];
  rings: Ring[];
  hexPoints?: HexPoint[] | null;
  hexColorBy?: "weight" | "score";
  hexMax?: number;
  pov?: Pov | null;
  autoRotate?: boolean;
  onAgent: (id: number) => void;
  onGlobe: (lat: number, lng: number) => void;
  onHex?: (lat: number, lng: number) => void;
  onBusiness?: (id: number) => void;
}

interface ParticleList { key: string; points: AgentPoint[]; color: string; size: number }

const scoreColor = (s: number) => (s < 450 ? BAND_COLOR.red : s < 600 ? BAND_COLOR.amber : s < 750 ? BAND_COLOR.neutral : BAND_COLOR.green);

export function WorldGlobe(p: Props) {
  const box = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [countries, setCountries] = useState<object[]>([]);
  const [ready, setReady] = useState(false);
  const elements = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e!.contentRect.width), h: Math.round(e!.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    fetch("/geo/countries-110m.geojson").then((r) => r.json()).then((fc: { features: object[] }) => setCountries(fc.features)).catch(() => setCountries([]));
  }, []);

  useEffect(() => {
    if (!ready || !globe.current) return;
    const c = globe.current.controls() as unknown as { autoRotate: boolean; autoRotateSpeed: number; enableDamping: boolean };
    c.autoRotate = !!p.autoRotate;
    c.autoRotateSpeed = 0.35;
    c.enableDamping = true;
  }, [ready, p.autoRotate]);

  useEffect(() => {
    if (ready && p.pov && globe.current) globe.current.pointOfView(p.pov, 1200);
  }, [ready, p.pov]);

  const material = useMemo(() => new THREE.MeshPhongMaterial({ color: "#0a1224", emissive: "#060b16", shininess: 6 }), []);

  const particles: ParticleList[] = useMemo(() => {
    if (p.dimmed && p.highlight) {
      return [
        { key: "dim", points: p.dimmed, color: "#1e293b", size: 1.6 },
        { key: "hi", points: p.highlight, color: "#f87171", size: 6 },
      ];
    }
    // Sizes are world units (globe radius 100): about 3 px at the default camera distance.
    const lists: ParticleList[] = BANDS.map((b) => ({ key: b, points: p.byBand[b], color: BAND_COLOR[b], size: b === "neutral" ? 2.2 : 3 }));
    lists.push({ key: "live", points: p.live, color: "#22d3ee", size: 6 });
    if (p.selected) lists.push({ key: "sel", points: [p.selected], color: "#ffffff", size: 8 });
    return lists;
  }, [p.byBand, p.live, p.selected, p.dimmed, p.highlight]);

  const businessEl = (d: object) => {
    const b = d as BusinessPoint;
    let el = elements.current.get(b.id);
    if (!el) {
      el = document.createElement("button");
      el.className = "globe-biz";
      el.title = `${b.name} · B-${String(b.id).padStart(3, "0")} · ${b.category}`;
      el.setAttribute("data-testid", `globe-business-${b.id}`);
      el.onclick = (ev) => { ev.stopPropagation(); p.onBusiness?.(b.id); };
      elements.current.set(b.id, el);
    }
    const px = Math.max(5, Math.min(26, b.size));
    el.style.width = `${px}px`;
    el.style.height = `${px}px`;
    el.style.opacity = b.dim ? "0.15" : "1";
    return el;
  };

  return (
    <div ref={box} className="absolute inset-0 isolate z-0" data-testid="globe">
      <style>{`.globe-biz{display:block;transform:translate(-50%,-50%) rotate(45deg);background:#fbbf24;border:1px solid #fff8;box-shadow:0 0 10px #fbbf2499;border-radius:2px;cursor:pointer;pointer-events:auto;padding:0}`}</style>
      <ReactGlobe
        ref={globe}
        width={size.w}
        height={size.h}
        backgroundColor="rgba(0,0,0,0)"
        globeMaterial={material}
        showAtmosphere
        atmosphereColor="#22d3ee"
        atmosphereAltitude={0.16}
        onGlobeReady={() => {
          setReady(true);
          if (process.env.NODE_ENV !== "production") (window as unknown as { __globe?: unknown }).__globe = globe.current;
        }}
        hexPolygonsData={countries}
        hexPolygonResolution={3}
        hexPolygonMargin={0.62}
        hexPolygonUseDots
        hexPolygonColor={() => "rgba(148,163,184,0.28)"}
        hexPolygonsTransitionDuration={0}
        particlesData={particles}
        particlesList="points"
        particleLat="lat"
        particleLng="lng"
        particleAltitude={0.008}
        particlesColor="color"
        particlesSize="size"
        particlesSizeAttenuation
        onParticleClick={(pt: object) => p.onAgent((pt as AgentPoint).id)}
        htmlElementsData={p.businesses}
        htmlLat="lat"
        htmlLng="lng"
        htmlAltitude={0.01}
        htmlElement={businessEl}
        htmlTransitionDuration={0}
        arcsData={p.arcs}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcColor="color"
        arcStroke="stroke"
        arcDashLength={(d: object) => (d as Arc).dash}
        arcDashGap={0.25}
        arcDashInitialGap={() => Math.random()}
        arcDashAnimateTime={1500}
        arcAltitudeAutoScale={0.35}
        arcsTransitionDuration={0}
        ringsData={p.rings}
        ringLat="lat"
        ringLng="lng"
        ringColor={(d: object) => (t: number) => `${(d as Ring).color}${Math.round((1 - t) * 255).toString(16).padStart(2, "0")}`}
        ringMaxRadius="max"
        ringPropagationSpeed="speed"
        ringRepeatPeriod={900}
        hexBinPointsData={p.hexPoints ?? []}
        hexBinPointLat="lat"
        hexBinPointLng="lng"
        hexBinPointWeight="weight"
        hexBinResolution={3}
        hexMargin={0.18}
        hexAltitude={(d: { sumWeight: number }) => (p.hexColorBy === "score" ? 0.02 : Math.min(0.35, (d.sumWeight / Math.max(1, p.hexMax ?? 1)) * 0.35 + 0.005))}
        hexTopColor={(d: { sumWeight: number; points: object[] }) => {
          if (p.hexColorBy === "score") {
            const pts = d.points as HexPoint[];
            return scoreColor(pts.reduce((s, x) => s + (x.score ?? 600), 0) / Math.max(1, pts.length));
          }
          const t = Math.min(1, d.sumWeight / Math.max(1, p.hexMax ?? 1));
          return `rgba(${Math.round(34 + t * 214)},${Math.round(211 - t * 98)},${Math.round(238 - t * 125)},${0.35 + t * 0.6})`;
        }}
        hexSideColor={() => "rgba(34,211,238,0.12)"}
        hexTransitionDuration={600}
        onHexClick={(h: { points: object[] }) => {
          const pts = h.points as HexPoint[];
          if (pts[0]) p.onHex?.(pts[0].lat, pts[0].lng);
        }}
        onGlobeClick={({ lat, lng }: { lat: number; lng: number }) => p.onGlobe(lat, lng)}
      />
    </div>
  );
}
