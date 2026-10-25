# Run Vouch World locally with Maincloud

This starts the web app and worker on your laptop and connects them to the existing Maincloud database `vouch-world`. It runs the 10,000-shopper world, the 100-shop Finance Desk simulation, and the five Finance CREAO seats. To open it from another computer or a phone (the QR claim), add the Cloudflare tunnels in section 5.

## 1. Install and configure

Requirements: Node 22, SpacetimeDB CLI 2.13.x, and ffmpeg. Factory Droid is only needed for `/lab` and the video-reviewer workflow.

```bash
npm install
spacetime login
```

Create `.env` if you do not already have one. Keep an existing `.env` intact:

```bash
[ -f .env ] || cp .env.example .env
```

Set these values in the root `.env`. Preserve any other configured CREAO, worker, and SpacetimeDB credentials. For live Finance CREAO runs, fill in all five app ID/API key pairs from `.env.example`.

```dotenv
STDB_URI=https://maincloud.spacetimedb.com
STDB_DB=vouch-world
NEXT_PUBLIC_STDB_URI=https://maincloud.spacetimedb.com
NEXT_PUBLIC_STDB_DB=vouch-world
NEXT_PUBLIC_DESK=1
FINANCE_DESK=1
FINANCE_CREAO_MODE=live
```

The five Finance CREAO pairs are `CREAO_FINANCE_IMPACT_ANALYST_APP_ID` + `CREAO_FINANCE_IMPACT_ANALYST_API_KEY`, `CREAO_FINANCE_IMPACT_REVIEWER_APP_ID` + `CREAO_FINANCE_IMPACT_REVIEWER_API_KEY`, `CREAO_FINANCE_CLOSE_CONTROLLER_APP_ID` + `CREAO_FINANCE_CLOSE_CONTROLLER_API_KEY`, `CREAO_FINANCE_ADVISOR_APP_ID` + `CREAO_FINANCE_ADVISOR_API_KEY`, and `CREAO_FINANCE_GUARDIAN_APP_ID` + `CREAO_FINANCE_GUARDIAN_API_KEY`. Keep these keys server-side in `.env`; do not add them to `NEXT_PUBLIC_*` variables.

## 2. Publish the schema and refresh bindings

The current Finance Desk adds `refund_out_cents` at the end of `finance_stats_hourly` with a zero default. That lets SpacetimeDB migrate existing hourly rows in place. Publish without `RESET=1` so the existing Maincloud world is preserved:

```bash
STDB_SERVER=maincloud STDB_DB=vouch-world npm run stdb:publish
npm run stdb:generate
```

The publisher may print `tsc not found in node_modules` followed by `Build finished successfully`; this is a SpacetimeDB CLI diagnostic, and it has not prevented the module build. The publish must finish successfully. If it still reports a required manual migration, stop there and do not add `RESET=1`.

Confirm the remote module has the finance tables:

```bash
spacetime sql vouch-world "SELECT * FROM finance_sim_state" -s maincloud
spacetime sql vouch-world "SELECT * FROM finance_company_state" -s maincloud
spacetime sql vouch-world "SELECT * FROM finance_stats_hourly LIMIT 1" -s maincloud
```

## 3. Start the worker

Open Terminal 1 in the repository and run:

```bash
STDB_URI=https://maincloud.spacetimedb.com STDB_DB=vouch-world FINANCE_DESK=1 FINANCE_CREAO_MODE=live npm run worker
```

The worker initializes the 10,000-shopper world if it has not been seeded and seeds the 100-shop finance portfolio if it has not been seeded. It does not reset existing state. Look for logs showing `world: ... 10000 agents`, the Finance CREAO app-pair status, and `Finance Desk portfolio is seeded`. If another worker is already bound to port 8787, stop that process before starting this one.

In another terminal, verify the HTTP worker and Finance CREAO configuration:

```bash
curl -s http://localhost:8787/health
curl -s http://localhost:8787/finance/creao/status
```

The CREAO status endpoint reports configuration and app checks; it does not prove a live run has completed. Live seat runs are recorded after their Finance Desk workflows execute.

## 4. Start the web app

Open Terminal 2 in the repository:

```bash
NEXT_PUBLIC_STDB_URI=https://maincloud.spacetimedb.com NEXT_PUBLIC_STDB_DB=vouch-world NEXT_PUBLIC_DESK=1 npm run dev
```

Open these pages in your browser:

- `http://localhost:3000/world` — 10,000 simulated shoppers on the globe.
- `http://localhost:3000/shop` — 100 fictional shops and their sample products.
- `http://localhost:3000/desk` — the network cashflow view, Vouch score visualization, fraud/exposure guidance, and Finance Desk records.
- `http://localhost:3000/lab` — Droid detector lab, when Factory Droid is configured.

On `/desk`, enter the controller code from `DEMO_CONTROLLER_CODE` in `.env` (local default: `vouch-controller`), choose **All 100 shops · network**, then press **Start portfolio**. Leave the speed at **Turbo** to make activity visible quickly. The finance simulation begins paused. Use **Ring attack**, **Sale day**, or **Defect batch** to introduce a labeled scenario into one shop and watch exposure and payout guidance respond. A proposed pause waits for a human controller; it never automatically denies refunds.

The cashflow view uses persistent company totals from `finance_company_state` and rolling payout rows from `finance_stats_hourly`. Its Vouch score is explicitly an illustrative simulation visualization, not real customer credit. Gross order value is simulated demand, not settled bank cash.

## 5. Share it through Cloudflare (phone QR and other computers)

Phones and other machines cannot open `localhost`. Two free Cloudflare quick tunnels give the web app and the worker public `https://…trycloudflare.com` addresses. No Cloudflare account is needed; the addresses change every time a tunnel restarts.

Install once: `brew install cloudflared`.

1. Start the worker (section 3) and leave it running.
2. Open one tunnel per service, each in its own terminal. The `--metrics` port lets you read the address back later:

   ```bash
   cloudflared tunnel --metrics 127.0.0.1:20242 --url http://localhost:8787
   ```

   ```bash
   cloudflared tunnel --metrics 127.0.0.1:20243 --url http://localhost:3001
   ```

3. Read the two public addresses:

   ```bash
   curl -s http://127.0.0.1:20242/quicktunnel
   ```

   ```bash
   curl -s http://127.0.0.1:20243/quicktunnel
   ```

   The first is the worker, the second the web app.
4. Build the web app with both addresses baked in, then serve it on port 3001. A production build matters here: `next dev` over a tunnel is slow on a phone. Replace the two hostnames with yours:

   ```bash
   cd web && NEXT_PUBLIC_SITE_URL=https://WEB-HOST.trycloudflare.com NEXT_PUBLIC_WORKER_URL=https://WORKER-HOST.trycloudflare.com NEXT_PUBLIC_STDB_URI=https://maincloud.spacetimedb.com NEXT_PUBLIC_STDB_DB=vouch-world NEXT_PUBLIC_DESK=1 npx next build
   ```

   ```bash
   cd web && npx next start -p 3001
   ```

5. Open `https://WEB-HOST.trycloudflare.com` on any computer. On the home page, the "Simulate returning wireless headphones" panel shows a QR code for a fresh live claim; scan it with a phone, record, and the desktop opens the merchant result. "Start another return" makes a new claim as often as you like.

Check it from the laptop: `curl -s https://WORKER-HOST.trycloudflare.com/health` should print `{"ok":true,…}`.

If a tunnel restarts, its address changes: rebuild the web app (step 4) with the new address and restart `next start`. The worker's own address only appears in the web build, so the worker itself does not need a restart.

To use the phone QR from `npm run dev` on port 3000 instead, run the web tunnel against port 3000 and put both addresses in a git-ignored `web/.env.local`:

```
NEXT_PUBLIC_SITE_URL=https://WEB-HOST.trycloudflare.com
NEXT_PUBLIC_WORKER_URL=https://WORKER-HOST.trycloudflare.com
```

## Optional: reset the shopper world

Only run this if you want to replace the existing 10,000-agent world with the demo seed and restart its simulation. It is not required for a normal startup and it resets shopper-world state. It does not reset or reseed the separate Finance Desk portfolio.

```bash
STDB_URI=https://maincloud.spacetimedb.com STDB_DB=vouch-world npx tsx scripts/demo-reset.ts
```

## Local SpacetimeDB instead of Maincloud

For an offline database, use a separate local database named `vouch`:

```bash
npm run stdb:start
```

In another terminal, publish the module and generate client bindings:

```bash
STDB_URI=ws://localhost:3011 STDB_DB=vouch npm run stdb:publish
npm run stdb:generate
```

Then start the worker and web app in separate terminals:

```bash
STDB_URI=ws://localhost:3011 STDB_DB=vouch FINANCE_DESK=1 FINANCE_CREAO_MODE=live npm run worker
```

```bash
NEXT_PUBLIC_STDB_URI=ws://localhost:3011 NEXT_PUBLIC_STDB_DB=vouch NEXT_PUBLIC_DESK=1 npm run dev
```

The local portfolio also starts paused. Use the local controller code on `/desk` to start it. `.env` values are overridden by the explicit local URI and database in these commands.

## Other optional services

- The main Vouch shopper agents use `CREAO_MODE=fixture` by default. Set `CREAO_MODE=live` only when the core Vouch CREAO agents and their credentials are ready. Finance CREAO uses the separate `FINANCE_CREAO_MODE` switch and five app-scoped credential pairs.
- Without `FACTORY_API_KEY` and the Droid CLI, the Detector Lab reports that Droid is unavailable. The simulation and Finance Desk do not require Droid.
- To run the video reviewer, install ffmpeg and the optional audio dependency with `pip install faster-whisper`. These are not required to inspect the world or finance simulation.

## Checks

```bash
npm run typecheck
npm run check:rules
npm run env:check
```

`npm run check` additionally runs the module and worker test suites. Run it when you want the full automated checks.
