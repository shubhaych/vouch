#!/usr/bin/env bash
# Publishes module/ as $STDB_DB (default vouch).
#   STDB_SERVER   a CLI server nickname or URL; default: the local standalone on $STDB_URI's port
#   RESET=1       wipe the database (demo data only) when the schema change is not an automatic migration
# Verified with spacetime CLI 2.13.0 against a local standalone server.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"
command -v spacetime >/dev/null || { echo "spacetime CLI not found: curl -sSf https://install.spacetimedb.com | sh" >&2; exit 1; }
DB="${STDB_DB:-vouch}"
URI="${STDB_URI:-ws://localhost:3011}"
SERVER="${STDB_SERVER:-$(echo "$URI" | sed -E 's#^ws(s?)://#http\1://#')}"
ARGS=(publish "$DB" -p module -s "$SERVER" -y)
if [ "${RESET:-0}" = "1" ]; then ARGS+=(--delete-data=on-conflict); fi
spacetime "${ARGS[@]}"
