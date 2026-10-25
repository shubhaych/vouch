"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSpacetimeDB } from "spacetimedb/react";
import type { DbConnection } from "@/module_bindings";
import { toast } from "@/components/ui/toast";

export function useConn(): DbConnection | null {
  const s = useSpacetimeDB();
  return s.getConnection() as DbConnection | null;
}

export type ConnStatus = "connecting" | "live" | "error";
export function useStatus(): { status: ConnStatus; identity: string | null; error?: string } {
  const s = useSpacetimeDB();
  if (s.isActive) return { status: "live", identity: s.identity?.toHexString() ?? null };
  if (s.connectionError) return { status: "error", identity: null, error: String(s.connectionError.message ?? s.connectionError) };
  return { status: "connecting", identity: null };
}

type TableName = keyof DbConnection["db"];

/**
 * Subscribes with raw SQL and returns a version number that bumps (at most
 * every `throttleMs`) when any subscribed row changes. Read rows straight
 * from conn.db. Used for big tables (10,000 agents) where copying the whole
 * table on every transaction would be wasteful.
 */
export function useTableVersion(table: TableName, sql: string | null, throttleMs = 500): { version: number; ready: boolean } {
  const conn = useConn();
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Subscriptions whose SQL was replaced but whose successor has not applied yet.
  const retiring = useRef<{ unsubscribe(): void }[]>([]);

  useEffect(() => () => {
    for (const h of retiring.current) { try { h.unsubscribe(); } catch { /* already gone */ } }
    retiring.current = [];
  }, []);

  useEffect(() => {
    if (!conn || !sql) return;
    let alive = true;
    const bump = () => {
      if (pending.current) return;
      pending.current = setTimeout(() => {
        pending.current = null;
        if (alive) setVersion((v) => v + 1);
      }, throttleMs);
    };
    // A query that changes with the sim day (e.g. "day >= from") resubscribes often. Dropping the
    // old subscription first emptied the cache and flashed a skeleton, so it stays until this one applies.
    const handle = conn.subscriptionBuilder().onApplied(() => {
      const old = retiring.current;
      retiring.current = [];
      for (const h of old) { try { h.unsubscribe(); } catch { /* already gone */ } }
      if (alive) { setReady(true); setVersion((v) => v + 1); }
    }).subscribe(sql);
    const t = conn.db[table] as unknown as {
      onInsert(cb: () => void): void; onDelete(cb: () => void): void; onUpdate?(cb: () => void): void;
      removeOnInsert(cb: () => void): void; removeOnDelete(cb: () => void): void; removeOnUpdate?(cb: () => void): void;
    };
    t.onInsert(bump);
    t.onDelete(bump);
    t.onUpdate?.(bump);
    return () => {
      alive = false;
      t.removeOnInsert(bump);
      t.removeOnDelete(bump);
      t.removeOnUpdate?.(bump);
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
      retiring.current.push(handle);
    };
  }, [conn, sql, table, throttleMs]);

  return { version, ready };
}

/** Calls a reducer and turns its error (thrown inside the module) into a toast. Returns true on success. */
export function useCall() {
  const conn = useConn();
  return useCallback(
    async <A,>(name: string, fn: (reducers: DbConnection["reducers"]) => Promise<A>, okMessage?: string): Promise<boolean> => {
      if (!conn) {
        toast(`Not connected to SpacetimeDB yet (${name})`, "fraud");
        return false;
      }
      try {
        await fn(conn.reducers);
        if (okMessage) toast(okMessage, "honest");
        return true;
      } catch (e) {
        toast(`${name}: ${(e as Error).message}`, "fraud");
        return false;
      }
    },
    [conn],
  );
}

/**
 * Rows of a table, re-read at most every `throttleMs`. For small tables that
 * change many times a second (business balances, region stats, the event
 * ring) where re-rendering on every transaction would waste the frame budget.
 */
export function useRowsThrottled<T>(table: TableName, sql: string, throttleMs = 400): { rows: T[]; ready: boolean } {
  const conn = useConn();
  const { version, ready } = useTableVersion(table, sql, throttleMs);
  const [rows, setRows] = useState<T[]>([]);
  useEffect(() => {
    if (!conn || !ready) return;
    setRows([...(conn.db[table] as unknown as { iter(): Iterable<T> }).iter()]);
  }, [conn, ready, version, table]);
  return { rows, ready };
}
