"use client";

import { useEffect, useRef, useState } from "react";
import { useConn, useStatus } from "./hooks";

/**
 * Sync latency, honestly measured: once a second the client calls ping(now)
 * and times its own row's arrival on its own clock (a round trip, so no clock
 * skew). Reports p50 and p95 over the last 60 samples.
 */
export function useLatency(enabled = true): { p50: number | null; p95: number | null; samples: number[] } {
  const conn = useConn();
  const { identity } = useStatus();
  const [state, setState] = useState<{ p50: number | null; p95: number | null; samples: number[] }>({ p50: null, p95: null, samples: [] });
  const samples = useRef<number[]>([]);

  useEffect(() => {
    if (!conn || !identity || !enabled) return;
    const handle = conn.subscriptionBuilder().subscribe(`SELECT * FROM latency_ping WHERE who = 0x${identity}`);
    const onInsert = (_ctx: unknown, row: { who: { toHexString(): string }; clientSentMs: number }) => {
      if (row.who.toHexString() !== identity) return;
      const rtt = Date.now() - row.clientSentMs;
      if (rtt < 0 || rtt > 30_000) return;
      samples.current = [...samples.current.slice(-59), rtt];
      const sorted = [...samples.current].sort((a, b) => a - b);
      const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
      setState({ p50: q(0.5), p95: q(0.95), samples: samples.current });
    };
    conn.db.latencyPing.onInsert(onInsert as never);
    const id = setInterval(() => { void conn.reducers.ping({ clientSentMs: Date.now() }).catch(() => undefined); }, 1000);
    return () => {
      clearInterval(id);
      conn.db.latencyPing.removeOnInsert(onInsert as never);
      try { handle.unsubscribe(); } catch { /* gone */ }
    };
  }, [conn, identity, enabled]);

  return state;
}
