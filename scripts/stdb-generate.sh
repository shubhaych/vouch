#!/usr/bin/env bash
# Generates TypeScript client bindings for web and worker from module/.
# Verified against the spacetime CLI 2.13.0 (flags: --lang, --out-dir, --module-path).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"
command -v spacetime >/dev/null || { echo "spacetime CLI not found: curl -sSf https://install.spacetimedb.com | sh" >&2; exit 1; }
spacetime generate --lang typescript --out-dir web/module_bindings --module-path module -y
spacetime generate --lang typescript --out-dir worker/module_bindings --module-path module -y
