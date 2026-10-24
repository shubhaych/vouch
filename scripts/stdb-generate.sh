#!/usr/bin/env bash
# Generates TypeScript bindings for web and worker from module/.
# UNVERIFIED for 2.x: confirm the generate flags against the SpacetimeDB quickstart.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v spacetime >/dev/null || { echo "spacetime CLI not found. Install it from the SpacetimeDB quickstart, then rerun." >&2; exit 1; }
spacetime generate --lang typescript --out-dir web/module_bindings --module-path module
spacetime generate --lang typescript --out-dir worker/module_bindings --module-path module
