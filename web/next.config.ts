import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// One .env at the repo root serves the worker and the web app. Next.js reads .env only from
// web/, so copy the browser-safe NEXT_PUBLIC_* values from the root file (never keys).
const rootEnv = resolve(import.meta.dirname, "..", ".env");
if (existsSync(rootEnv)) {
  for (const line of readFileSync(rootEnv, "utf8").split("\n")) {
    const m = line.match(/^\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*=\s*([^#\n]*?)\s*(?:#.*)?$/);
    if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!;
  }
}

// Fixture data must never ship as if it were live: a production build in
// fixture mode fails on purpose (T6.4). `next dev` shows a red banner instead.
if (process.env.NEXT_PUBLIC_DATA === "fixture" && process.argv.includes("build")) {
  throw new Error("NEXT_PUBLIC_DATA=fixture is for local development only; refusing to build fixture data into a deployable app.");
}

const nextConfig: NextConfig = {
  // The engine's pure code (world, score, sim labels) is shared from the module workspace as TypeScript source.
  transpilePackages: ["@vouch/module"],
  turbopack: {
    root: resolve(import.meta.dirname, ".."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
