# Bright Data: the scrapers behind the Listing Matcher and the Returns Monitor

The worker scrapes, the agents read. No CREAO agent holds a Bright Data token; the worker fetches what an agent needs, caches it, and hands it over inside the agent's `case`, the same way it hands over video frames. That keeps keys server-side, makes every scrape visible on screen with its source and time, and lets the whole flow run with no token in fixture mode.

## What is scraped, and for whom

| Scrape | How | Who reads it | What it is used for |
| --- | --- | --- | --- |
| **Listings** that look like the ordered item | Google Shopping through the SERP API: `https://www.google.com/search?q=<item>&udm=28&brd_json=1` | Listing Matcher (Agent 6) | Which listing the frames show, whether it is the ordered item, what differs (model, colour, parts, price) |
| **Return signals** for the busiest items | Google web search: `"<item>" returns OR refund OR defective OR recall reviews`, top 5 organic results | Returns Monitor (Agent 7) | Descriptive context for a spike: a known defect, a recall, a strict return policy. Never a rate. |

Both go through one endpoint, `POST https://api.brightdata.com/request` with `{ zone, url, format: "raw" }` and `Authorization: Bearer <token>` (Bright Data's docs, read 2026-10-24). The SERP API returns parsed JSON when the Google URL carries `brd_json=1`; `worker/src/brightdata.ts` normalises the `shopping` and `organic` arrays and ignores everything else. Listing pages themselves are not fetched; a Web Unlocker zone name is configured for when that is wanted.

## Files

| Path | What |
| --- | --- |
| `worker/src/brightdata.ts` | The client: `searchListings(item)`, `searchReturnSignals(item)`, normalisers (unit tested), disk cache, daily budget, fixture listings built from the catalogue |
| `worker/src/pulse.ts` | The returns pulse (worker arithmetic over live refund rows) and the Returns Monitor flow that scrapes signals for the top three items |
| `worker/src/orchestrator.ts` | The Listing Matcher step: scrape listings for the ordered item, run the agent, guard the verdict, record it as `evidence` with seat `listing_matcher` |
| `worker/test/brightdata.test.ts` | Normalisation of recorded SERP shapes, fixture mode, the token and budget guards |
| `worker/.cache/brightdata/` | Cached responses, one JSON per query, 24 h by default. Git-ignored. |

## Environment

```
BRIGHTDATA_MODE=fixture          # live to scrape; fixture builds listings from the catalogue and never calls out
BRIGHTDATA_API_TOKEN=            # dashboard → API tokens. Never in web/ (scripts/check-rules.ts greps for the name)
BRIGHTDATA_SERP_ZONE=serp_api    # the name of a SERP API zone in your dashboard
BRIGHTDATA_UNLOCKER_ZONE=web_unlocker
BRIGHTDATA_DAILY_LIMIT=60        # live scrapes per day; cache hits are free
BRIGHTDATA_CACHE_HOURS=24
```

Setup for live mode: create a **SERP API** zone in the Bright Data dashboard (its name goes in `BRIGHTDATA_SERP_ZONE`), copy an API token into `.env`, set `BRIGHTDATA_MODE=live`, restart the worker. `GET :8787/scrape/status` shows the mode, what is missing, and today's count.

## Budget and cost

- One claim costs at most **one** listings scrape (cached per item name for a day, so repeat claims for the same item are free).
- One Returns Monitor run costs at most **three** signal scrapes (its three busiest items, also cached).
- The daily limit stops new scrapes; the agents then see `scraped_listings.items: []` with an `error` line and answer "uncertain" or "no context", never a decline.

## Honesty on screen

- Scraped data is shown with a chip that says **via Bright Data** when it was fetched live and **fixture** otherwise, plus the fetch time and whether it came from the cache (`/business`: the Listing match card, the Returns pulse panel).
- Fixture listings are built from the catalogue (`fixtureListings`) and look like listings; the chip says so.
- The pulse itself is **Live**: it is counted from refund rows as they arrive. The shopper-band breakdown is **Simulated** (the bands come from the simulated credit score).
- Return signals are search results about an item. They are context for a person, not a return rate and not evidence against any shopper.

## Rules the code keeps

- No listing, a scrape error or unreadable frames → the Listing Matcher's verdict is `needs_person` (`guardListingMatch` in `worker/src/orchestrator.ts`). `ineligible` stands only outside the return window or for a clearly different item at confidence ≥ 0.8.
- The Returns Monitor is given items, businesses and band counts, never shopper ids; `guardMonitor` scrubs anything that looks like one and drops anomaly kinds outside `spike`, `possible_defective_batch`, `clustered_timing`, `new_item_returns`, `none`.
- Logs print the query and the result count, never the token or the page.

## Status in this build

Fixture mode only: no Bright Data token was available, so no live scrape has run from this repository. The request shape follows the docs; the first live scrape should be checked with `BRIGHTDATA_MODE=live npx tsx -e "import('./worker/src/brightdata.ts').then(m => m.searchListings('Wireless earbuds').then(r => console.log(r.source, r.items.length, r.error)))"` from the repo root, and the normaliser adjusted if the `shopping` rows carry different field names than the recorded shape in `worker/test/brightdata.test.ts`.
