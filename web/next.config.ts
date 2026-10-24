import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Pure policy code (types, handshake, decide) is shared from the module workspace as TypeScript source.
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
