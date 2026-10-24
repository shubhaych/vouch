// Tiny .env loader for scripts (no dependency). Run scripts from the repo root.
import { readFileSync } from "node:fs";

export function loadEnv(path = ".env"): void {
  let text = "";
  try { text = readFileSync(path, "utf8"); } catch { return; }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\n]*?)\s*(?:#.*)?$/);
    if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!;
  }
}

export function need(...keys: string[]): void {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing in .env: ${missing.join(", ")}`);
    process.exit(1);
  }
}

/** For scripts that need the SpacetimeDB bindings. Exit code 2 = not wired yet (not a failure of your input). */
export function notWired(what: string, needs: string): never {
  console.error(`${what} is not wired yet: ${needs}`);
  process.exit(2);
}
