"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useConn, useRowsThrottled, useTableVersion } from "@/lib/stdb/hooks";

export type Band = "red" | "amber" | "neutral" | "green";
export const BANDS: Band[] = ["red", "amber", "neutral", "green"];
export const BAND_COLOR: Record<Band, string> = { red: "#F87171", amber: "#FBBF24", neutral: "#8FB3D9", green: "#34D399" };

export interface AgentPoint { id: number; lat: number; lng: number; band: Band; score: number; region: number; isLive: boolean; purchases: number; refunds: number }

interface AgentsState {
  ready: boolean;
  count: number;
  byId: Map<number, AgentPoint>;
  /** Stable arrays: only rebuilt when an agent changes band, so the globe does not rebuild 10,000 points every update. */
  byBand: Record<Band, AgentPoint[]>;
  live: AgentPoint[];
  all: AgentPoint[];
  nearest: (lat: number, lng: number, maxDeg?: number) => AgentPoint | null;
  version: number;
}

const CELL = 2; // degrees

/** All agents, read from the client cache, refreshed at most every 1.5 s. */
export function useAgents(): AgentsState {
  const conn = useConn();
  const { version, ready } = useTableVersion("agent", "SELECT * FROM agent", 1500);
  const prev = useRef<{ key: string; byBand: Record<Band, AgentPoint[]>; live: AgentPoint[]; grid: Map<string, AgentPoint[]>; all: AgentPoint[]; at: number } | null>(null);

  return useMemo(() => {
    const byId = new Map<number, AgentPoint>();
    if (!conn || !ready) {
      return { ready: false, count: 0, byId, byBand: { red: [], amber: [], neutral: [], green: [] }, live: [], all: [], nearest: () => null, version };
    }
    let key = "";
    const rows = [...conn.db.agent.iter()].sort((a, b) => a.id - b.id);
    for (const a of rows) {
      const band = (a.band as Band) || "neutral";
      byId.set(a.id, { id: a.id, lat: a.lat, lng: a.lng, band, score: a.score, region: a.region, isLive: a.isLive, purchases: a.purchases, refunds: a.refunds });
      key += band[0];
    }
    // Re-bucket at most every 5 s: each re-bucket rebuilds point clouds on the globe (QA-014).
    if (!prev.current || (prev.current.key !== key && Date.now() - prev.current.at > 5000)) {
      const byBand: Record<Band, AgentPoint[]> = { red: [], amber: [], neutral: [], green: [] };
      const live: AgentPoint[] = [];
      const grid = new Map<string, AgentPoint[]>();
      const all: AgentPoint[] = [];
      for (const p of byId.values()) {
        (p.isLive ? live : byBand[p.band]).push(p);
        all.push(p);
        const k = `${Math.floor(p.lat / CELL)}:${Math.floor(p.lng / CELL)}`;
        const cell = grid.get(k);
        if (cell) cell.push(p); else grid.set(k, [p]);
      }
      prev.current = { key, byBand, live, grid, all, at: Date.now() };
    }
    const { byBand, live, grid, all } = prev.current;
    const nearest = (lat: number, lng: number, maxDeg = 2.5) => {
      let best: AgentPoint | null = null;
      let bestD = maxDeg * maxDeg;
      const ci = Math.floor(lat / CELL);
      const cj = Math.floor(lng / CELL);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        for (const p of grid.get(`${ci + di}:${cj + dj}`) ?? []) {
          const d = (p.lat - lat) ** 2 + ((p.lng - lng) * Math.cos((lat * Math.PI) / 180)) ** 2;
          if (d < bestD) { bestD = d; best = byId.get(p.id) ?? p; }
        }
      }
      return best;
    };
    return { ready: true, count: byId.size, byId, byBand, live, all, nearest, version };
  }, [conn, ready, version]);
}

export interface FeedEvent { seq: bigint; day: number; kind: string; agentId: number; businessId: number; amount: number; refId: bigint; line: string }

/** Events a person acts on. The 512-row ring turns over in seconds at full speed, so the client keeps these. */
export const PEOPLE_KINDS = new Set(["join", "claim", "decision", "pattern", "refund_declined", "system", "delivery"]);

/** The 512-row live event ring, newest first, re-read at most every 400 ms, plus the person-level events seen so far. */
export function useFeed(): { events: FeedEvent[]; people: FeedEvent[]; ready: boolean } {
  const conn = useConn();
  const { rows, ready } = useRowsThrottled<FeedEvent>("eventFeed", "SELECT * FROM event_feed", 400);
  const kept = useRef(new Map<string, FeedEvent>());
  const [peopleVersion, setPeopleVersion] = useState(0);
  // Row callbacks see every event even when rendering is slow, so person-level events are never missed.
  useEffect(() => {
    if (!conn) return;
    const keep = (row: FeedEvent) => {
      if (!PEOPLE_KINDS.has(row.kind)) return;
      kept.current.set(row.seq.toString(), row);
      if (kept.current.size > 400) kept.current = new Map([...kept.current.entries()].sort((a, b) => (BigInt(a[0]) < BigInt(b[0]) ? 1 : -1)).slice(0, 200));
      setPeopleVersion((v) => v + 1);
    };
    const onInsert = (_c: unknown, row: FeedEvent) => keep(row);
    const onUpdate = (_c: unknown, _old: FeedEvent, row: FeedEvent) => keep(row);
    conn.db.eventFeed.onInsert(onInsert as never);
    conn.db.eventFeed.onUpdate(onUpdate as never);
    return () => {
      conn.db.eventFeed.removeOnInsert(onInsert as never);
      conn.db.eventFeed.removeOnUpdate(onUpdate as never);
    };
  }, [conn]);
  const events = useMemo(() => [...rows].sort((a, b) => (a.seq < b.seq ? 1 : a.seq > b.seq ? -1 : 0)), [rows]);
  const people = useMemo(() => {
    for (const e of events) if (PEOPLE_KINDS.has(e.kind)) kept.current.set(e.seq.toString(), e);
    return [...kept.current.values()].sort((a, b) => (a.seq < b.seq ? 1 : -1)).slice(0, 200);
    // peopleVersion is the signal that kept.current changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, peopleVersion]);
  return { events, people, ready };
}

/**
 * Keeps one object per id across updates. react-globe.gl matches data by object identity, so
 * fresh arc and ring objects every 400 ms made it dispose and rebuild every arc, and three.js
 * recompiled the dash shader each time (about 60% of the main thread in a profile, QA-014).
 */
export function useStableById<T extends { id: string }>(items: T[]): T[] {
  const cache = useRef(new Map<string, T>());
  return useMemo(() => {
    const next = new Map<string, T>();
    const out = items.map((it) => {
      const kept = cache.current.get(it.id) ?? it;
      next.set(it.id, kept);
      return kept;
    });
    cache.current = next;
    return out;
  }, [items]);
}

export interface Arc { id: string; startLat: number; startLng: number; endLat: number; endLng: number; color: string | string[]; dash: number; stroke: number; kind: string }
export interface Ring { id: string; lat: number; lng: number; color: string; max: number; speed: number }

const CATEGORY_COLOR: Record<string, string> = {
  electronics: "#22d3ee", apparel: "#f472b6", home: "#fbbf24", beauty: "#c084fc", "sporting goods": "#4ade80", toys: "#fb923c",
};

/** Purchases draw agent → business in the store's category colour; refunds draw back, amber (asked), green (paid), red (declined). */
export function arcsFromFeed(events: FeedEvent[], agents: Map<number, AgentPoint>, businesses: Map<number, { lat: number; lng: number; category: string }>, limit = 120): Arc[] {
  const out: Arc[] = [];
  for (const e of events) {
    if (out.length >= limit) break;
    const a = agents.get(e.agentId);
    const b = businesses.get(e.businessId);
    if (!a || !b) continue;
    if (e.kind === "purchase") {
      const c = CATEGORY_COLOR[b.category] ?? "#22d3ee";
      out.push({ id: `p${e.seq}`, startLat: a.lat, startLng: a.lng, endLat: b.lat, endLng: b.lng, color: [`${c}22`, c], dash: 0.5, stroke: 0.35, kind: e.kind });
    } else if (e.kind === "refund" || e.kind === "refund_accepted" || e.kind === "refund_declined") {
      const c = e.kind === "refund" ? "#fbbf24" : e.kind === "refund_accepted" ? "#34d399" : "#f87171";
      out.push({ id: `r${e.seq}`, startLat: b.lat, startLng: b.lng, endLat: a.lat, endLng: a.lng, color: [c, `${c}33`], dash: 0.15, stroke: 0.45, kind: e.kind });
    }
  }
  return out;
}

export function ringsFromFeed(events: FeedEvent[], agents: Map<number, AgentPoint>, limit = 36): Ring[] {
  const out: Ring[] = [];
  for (const e of events) {
    if (out.length >= limit) break;
    const a = agents.get(e.agentId);
    if (!a) continue;
    if (e.kind === "pattern") out.push({ id: `g${e.seq}`, lat: a.lat, lng: a.lng, color: "#f87171", max: 6, speed: 3 });
    else if (e.kind === "refund") out.push({ id: `g${e.seq}`, lat: a.lat, lng: a.lng, color: "#fbbf24", max: 2.2, speed: 2 });
    else if (e.kind === "claim" || e.kind === "decision" || e.kind === "join") out.push({ id: `g${e.seq}`, lat: a.lat, lng: a.lng, color: "#22d3ee", max: 4, speed: 2.5 });
  }
  return out;
}
