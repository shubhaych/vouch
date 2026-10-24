"use client";

import { useMemo, type ReactNode } from "react";
import { SpacetimeDBProvider } from "spacetimedb/react";
import { DbConnection } from "@/module_bindings";
import { STDB_DB, STDB_URI, loadToken, saveToken } from "./config";

// One connection per tab. The identity token is kept in localStorage so a
// shopper keeps the same agent across reloads; a phone that opens a claim
// link gets its own identity and only reads public claim rows.
export function StdbProvider({ children }: { children: ReactNode }) {
  const builder = useMemo(
    () =>
      DbConnection.builder()
        .withUri(STDB_URI)
        .withDatabaseName(STDB_DB)
        .withToken(loadToken())
        .withAutomaticReconnect()
        .onConnect((_conn, _identity, token) => saveToken(token))
        .onAutomaticReconnect((_conn, _identity, token) => saveToken(token)),
    [],
  );
  return <SpacetimeDBProvider connectionBuilder={builder}>{children}</SpacetimeDBProvider>;
}
