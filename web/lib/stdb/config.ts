// Browser-visible configuration only. No keys here: the worker holds them.
export const STDB_URI = process.env.NEXT_PUBLIC_STDB_URI || "ws://localhost:3011";
export const STDB_DB = process.env.NEXT_PUBLIC_STDB_DB || "vouch";
export const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
export const FIXTURE_MODE = process.env.NEXT_PUBLIC_DATA === "fixture";
/** Media links are signed over path and expiry only, so a link stored as localhost can be served from the worker's public address. */
export const mediaUrl = (u: string) => u.replace(/^https?:\/\/(?:localhost|127\.0\.0\.1):\d+/, WORKER_URL.replace(/\/$/, ""));
const TOKEN_KEY = `vouch.stdb.token.${STDB_DB}`;

export const loadToken = (): string | undefined => {
  if (typeof window === "undefined") return undefined;
  try { return window.localStorage.getItem(TOKEN_KEY) ?? undefined; } catch { return undefined; }
};
export const saveToken = (token: string) => {
  try { window.localStorage.setItem(TOKEN_KEY, token); } catch { /* private mode: identity lasts one tab */ }
};
