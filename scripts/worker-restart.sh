#!/usr/bin/env bash
# Restarts the local worker in the background (logs to .stdb/worker.log). Dev convenience.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${WORKER_PORT:-8787}"
fuser -k "$PORT/tcp" >/dev/null 2>&1 || true
sleep 1
mkdir -p .stdb
nohup npx tsx worker/src/server.ts > .stdb/worker.log 2>&1 &
echo "worker starting on :$PORT (log: .stdb/worker.log)"
