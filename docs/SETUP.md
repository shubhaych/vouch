# Setup

You need Node 22, ffmpeg and the SpacetimeDB CLI. On the demo laptop you also need the Droid CLI and a tunnel for the phone. Keys live in environment variables or a git-ignored `.env` (names in `.env.example`); nothing secret goes in the repo.

## Install

```bash
# ffmpeg (worker video pipeline)
sudo apt-get install -y ffmpeg            # macOS: brew install ffmpeg

# SpacetimeDB CLI (verified in the cloud session: installs 2.13.x to ~/.local/bin)
curl -sSf https://install.spacetimedb.com | sh

# Droid CLI (demo laptop only). Take the current command from Factory's docs (check); then:
droid --version

npm install
```

## Cloud environment setup script

Paste this into the Claude Code cloud environment's setup script:

```bash
set -e
apt-get update && apt-get install -y ffmpeg
curl -sSf https://install.spacetimedb.com | sh
export PATH="$HOME/.local/bin:$PATH"
if [ -n "$SPACETIMEDB_LOGIN_TOKEN" ]; then spacetime login --token "$SPACETIMEDB_LOGIN_TOKEN"; fi
npm install
```

Without network access to Maincloud, the session runs its own local server: `npm run stdb:start`.

## Run locally (no keys needed)

```bash
cp .env.example .env
npm run stdb:start                        # local SpacetimeDB on :3011 (logs .stdb/server.log)
npm run stdb:publish                      # RESET=1 wipes demo data when a schema change cannot migrate
npm run stdb:generate                     # bindings for web/ and worker/
npm run worker                            # :8787; first start claims the worker role (token saved in worker/.keys/)
npm run dev                               # http://localhost:3000
npx tsx scripts/demo-reset.ts             # seed 11, 10,000 agents, tick running
```

With `CREAO_MODE=fixture` (the default), the agents answer from `worker/fixtures/`, and every result is badged Fixture. Without `FACTORY_API_KEY`, lab jobs end with "Droid unavailable here; nothing was run."

Seats:
- **Business:** on `/business`, enter `DEMO_BUSINESS_CODE` (default `vouch-business` locally).
- **Controller:** use `DEMO_CONTROLLER_CODE` (default `vouch-controller` locally). Set your own codes for any shared deployment.

## Maincloud and the demo laptop

1. `spacetime login`, then `STDB_SERVER=maincloud STDB_DB=vouch-world npm run stdb:publish`.
   - The CLI may print "tsc not found in node_modules". That is harmless: npm workspaces keep TypeScript in the root `node_modules`, and the build still finishes.
2. Put these in `.env` at the repo root (`cp .env.example .env` first). One file serves the worker and the web app; `web/next.config.ts` copies only the `NEXT_PUBLIC_*` lines into the browser build:
   ```bash
   STDB_URI=https://maincloud.spacetimedb.com
   STDB_DB=vouch-world
   NEXT_PUBLIC_STDB_URI=https://maincloud.spacetimedb.com
   NEXT_PUBLIC_STDB_DB=vouch-world
   ```
   Without them the worker connects to `ws://localhost:3011/vouch` and fails with "non-101 status code". Each server and database gets its own saved token in `worker/.keys/`, so switching between local and Maincloud is safe.
3. Start the worker once, right after publishing. The first identity to call `bootstrapWorker` becomes the worker, and the ledger poster is a second identity. If another machine claimed the role first, republish with `RESET=1` (demo data only).
4. Start a tunnel to `:8787` and set `NEXT_PUBLIC_WORKER_URL` to its URL, so phones can upload. On the laptop, `CREAO_WEBHOOK_URL` is the tunnel URL plus `/creao/webhook`.
5. Run the demo on a production build: `npm run build && npm run start`.
   - `next dev` adds React's development checks. With them, `/world` kept the main thread about 35–100% busier in our measurements (`qa/results/world-perf-*.json`).
   - Check 45 fps on `/world` on the laptop itself, because headless runs render WebGL in software.
6. Run [LIVE_CHECKLIST.md](LIVE_CHECKLIST.md) top to bottom.

## Checks

```bash
npm run check                             # typecheck, module + worker tests, rule checks
npm run lint                              # web lint
npx tsx scripts/check-badges.ts           # every number on every page carries a badge (needs the dev server)
npx playwright test e2e/                  # browser smoke tests against the running stack
npx tsx scripts/env-check.ts              # live / missing / failed per service → docs/ENV_STATUS.md
```
