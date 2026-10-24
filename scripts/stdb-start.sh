#!/usr/bin/env bash
# Starts a local SpacetimeDB standalone server on $STDB_URI's port (default 3011) in the background.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
PORT="$(echo "${STDB_URI:-ws://localhost:3011}" | sed -E 's#.*:([0-9]+).*#\1#')"
if curl -sf "http://localhost:$PORT/v1/ping" >/dev/null; then echo "SpacetimeDB already listening on $PORT"; exit 0; fi
mkdir -p .stdb
nohup spacetime start --listen-addr "0.0.0.0:$PORT" --non-interactive --page_pool_max_size 1073741824 > .stdb/server.log 2>&1 &
for _ in $(seq 1 30); do curl -sf "http://localhost:$PORT/v1/ping" >/dev/null && { echo "SpacetimeDB listening on $PORT"; exit 0; }; sleep 1; done
echo "SpacetimeDB did not start; see .stdb/server.log" >&2; exit 1
