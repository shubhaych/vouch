#!/usr/bin/env bash
# Publishes module/ to SpacetimeDB under the name in $STDB_DB (default: vouch).
# UNVERIFIED for 2.x: the CLI could not be installed when the guide was written.
# Confirm flags against the SpacetimeDB quickstart and fix this script once.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v spacetime >/dev/null || { echo "spacetime CLI not found. Install it from the SpacetimeDB quickstart, then rerun." >&2; exit 1; }
spacetime publish "${STDB_DB:-vouch}" --module-path module
