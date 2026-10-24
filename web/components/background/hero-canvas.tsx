"use client";

// Copied from Constructa's HeroCanvas (src/components/landing/HeroCanvas.tsx):
// the same orbitable low-poly district, slow auto-rotate and "drag to rotate"
// hint. Changed only, per the spec: colours (dark storefront blocks with cyan
// and amber lit windows on a slate grid) and density (more, smaller lots).
import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";

export function HeroCanvas() {
  const [mounted, setMounted] = useState(false);
  const [interacted, setInteracted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="hero__canvas hero__canvas--poster" aria-hidden />;
  return (
    <div className="hero__canvas" onPointerDown={() => setInteracted(true)} data-testid="hero-canvas">
      <Canvas dpr={[1, 2]} shadows>
        <Scene />
      </Canvas>
      <div className={`rotate-hint ${interacted ? "rotate-hint--hidden" : ""}`} aria-hidden>
        <span>‹</span>
        <span>Drag to rotate</span>
        <span>›</span>
      </div>
    </div>
  );
}

function Scene() {
  return (
    <>
      <PerspectiveCamera makeDefault position={[11, 6.5, 13]} fov={40} />
      <fog attach="fog" args={["#0b0f14", 14, 36]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[8, 12, 6]} intensity={0.9} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-6, 5, -5]} intensity={0.3} color="#22d3ee" />
      <District />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#0f1623" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[40, 40, 40, 40]} />
        <meshBasicMaterial color="#1e3a4c" wireframe transparent opacity={0.35} />
      </mesh>
      <OrbitControls makeDefault enablePan={false} enableZoom={false} autoRotate autoRotateSpeed={0.85} enableDamping dampingFactor={0.08}
        minPolarAngle={Math.PI / 4} maxPolarAngle={Math.PI / 2.15} target={[0, 1.4, 0]} />
    </>
  );
}

// Density: 12 lots on a tighter grid instead of Constructa's 7.
function District() {
  const lots = useMemo(() => {
    const palette = ["#18212f", "#1b2536", "#16202d", "#1d2839"];
    const defs: { pos: [number, number, number]; floors: number; w: number; d: number; color: string }[] = [];
    const grid: [number, number, number][] = [
      [0, 0, 8], [-3.4, 0.4, 5], [3.3, -0.3, 6], [-3.1, -3.8, 7], [0.3, -4.2, 4], [3.8, -3.9, 5],
      [-3.6, 3.9, 6], [0.2, 3.7, 3], [3.7, 3.6, 5], [-6.6, 0.2, 4], [6.6, 0.1, 6], [0.1, -7.2, 5],
    ];
    grid.forEach(([x, z, floors], i) => defs.push({ pos: [x, 0, z], floors, w: 1.8 + (i % 3) * 0.2, d: 1.6 + (i % 2) * 0.3, color: palette[i % palette.length]! }));
    return defs;
  }, []);
  return (
    <group>
      {lots.map((l, i) => <Block key={i} index={i} position={l.pos} floors={l.floors} width={l.w} depth={l.d} color={l.color} />)}
    </group>
  );
}

// Constructa's small linear congruential generator, so the lit windows are the same on every render.
function lcg(seed: number) {
  let s = seed;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

function Block({ index, position, floors, width, depth, color }: { index: number; position: [number, number, number]; floors: number; width: number; depth: number; color: string }) {
  const FLOOR_H = 0.6;
  const bodyH = floors * FLOOR_H;
  const windows = useMemo(() => {
    const out: { pos: [number, number, number]; rot: [number, number, number]; lit: string | null }[] = [];
    const rnd = lcg(index * 9301 + 49297);
    for (let f = 0; f < floors; f++) {
      const y = FLOOR_H * (f + 0.5);
      for (let c = 0; c < 3; c++) {
        const x = -width / 2 + (width / 4) * (c + 1);
        const lit = rnd() < 0.42 ? (rnd() < 0.75 ? "#22d3ee" : "#fbbf24") : null;
        out.push({ pos: [x, y, depth / 2 + 0.001], rot: [0, 0, 0], lit });
        out.push({ pos: [x, y, -depth / 2 - 0.001], rot: [0, Math.PI, 0], lit: rnd() < 0.3 ? "#22d3ee" : null });
      }
      for (let c = 0; c < 2; c++) {
        const z = -depth / 2 + (depth / 3) * (c + 1);
        out.push({ pos: [width / 2 + 0.001, y, z], rot: [0, Math.PI / 2, 0], lit: rnd() < 0.35 ? "#22d3ee" : null });
        out.push({ pos: [-width / 2 - 0.001, y, z], rot: [0, -Math.PI / 2, 0], lit: rnd() < 0.35 ? "#fbbf24" : null });
      }
    }
    return out;
  }, [index, floors, width, depth]);
  return (
    <group position={position}>
      <mesh position={[0, bodyH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, bodyH, depth]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {Array.from({ length: floors - 1 }, (_, i) => (
        <mesh key={`band-${i}`} position={[0, FLOOR_H * (i + 1), 0]}>
          <boxGeometry args={[width + 0.04, 0.03, depth + 0.04]} />
          <meshStandardMaterial color="#233046" />
        </mesh>
      ))}
      {windows.map((w, i) => (
        <mesh key={`win-${i}`} position={w.pos} rotation={w.rot}>
          <planeGeometry args={[0.3, 0.34]} />
          <meshStandardMaterial color={w.lit ?? "#0d141f"} emissive={w.lit ?? "#000000"} emissiveIntensity={w.lit ? 0.9 : 0} />
        </mesh>
      ))}
      <mesh position={[0, bodyH + 0.04, 0]} castShadow>
        <boxGeometry args={[width + 0.1, 0.1, depth + 0.1]} />
        <meshStandardMaterial color="#26344a" />
      </mesh>
      {/* storefront awning in the accent colour */}
      <mesh position={[0, 0.62, depth / 2 + 0.16]}>
        <boxGeometry args={[width * 0.8, 0.05, 0.32]} />
        <meshStandardMaterial color={index % 3 === 0 ? "#f59e0b" : "#0e7490"} emissive={index % 3 === 0 ? "#f59e0b" : "#22d3ee"} emissiveIntensity={0.25} />
      </mesh>
    </group>
  );
}
