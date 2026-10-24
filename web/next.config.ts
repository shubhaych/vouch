import type { NextConfig } from "next";
import { resolve } from "node:path";

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
