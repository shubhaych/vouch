# Verified facts

The spec marked some facts **(check)**. This file records what was actually found, against which version, and how. "Not verified" means nobody has checked it against the live system yet; the matching command is in [LIVE_CHECKLIST.md](LIVE_CHECKLIST.md).

Session: Claude Code cloud container, 2026-10-23/24. SpacetimeDB 2.13.0 standalone (`spacetime start`, port 3011), Node 22, ffmpeg 6.1.1, Next.js 16.4.3, Playwright 1.63.0.

## SpacetimeDB (`spacetimedb` 2.13.0): verified by publishing and running

| Fact | Found | How |
| --- | --- | --- |
| Table, column and index builders as in the spec | Yes | `module/src/schema.ts` (31 tables) publishes with `npm run stdb:publish` |
| Scheduled reducer via a `scheduledId` + `scheduledAt` table and `{ onSchedule }` | Yes. `ScheduleAt.interval(200_000n)` fires every ~200 ms. The measured interval is 203 ms with 1,000 agents per tick. | `metrics.last_tick_micros`; `SELECT day FROM sim_run` advances on its own |
| The entry file may export only reducers, views and procedures | Yes. Exporting a helper fails the publish with "exporting something that is not a spacetime export". | `module/src/index.ts` re-exports by name |
| Table and view row type names must be unique across the module | Yes. "name MyAgent used for multiple types" until the view's row type was renamed `MyAgentRow`, and the `ping` table `latency_ping`. | publish error |
| `init` runs once on first publish and can schedule the tick | Yes | `module/src/economy.ts` `init` |
| Is `init`'s `ctx.sender` the publisher? | Not relied on. The worker claims the `worker` role with `bootstrapWorker` on first connect, and later identities are refused. | `module/src/reducers.test.ts` |
| Module test harness `spacetimedb/server/test-utils` | `createModuleTestHarness` and the vitest plugin `spacetimedbModuleTestPlugin` exist; identities come from `TestAuth.fromJwtPayload(...)` | `module/src/testkit.ts`; 19 module tests pass |
| Client builder `withUri().withDatabaseName().withToken()` | Yes. Reducer calls return promises that reject with the module's error message. | `worker/src/stdb.ts`, `scripts/hello-stdb.ts` |
| React `SpacetimeDBProvider`, `useTable(query, { enabled })` | Yes. A u64 filter cannot take `-1n` as a "none" value, so `enabled: false` is used instead. | `web/lib/stdb/provider.tsx`, `web/components/claim/claim-view.tsx` |
| SQL over the CLI | snake_case column names; identity literals are written `0x<hex>` | `spacetime sql vouch "SELECT day, max_day FROM sim_run" -s dev3011` |
| The client cache's `find()` on a unique column is fast | **No.** It scanned linearly in our test, about 65 ms per call at 200,000 rows, so the worker keeps its own indexed Maps. | `worker/src/mirror.ts`; one detector run went from 60 s to 1 s |
| Reducer round trip | p50 2 ms, p95 4 ms (local server) | `npx tsx scripts/hello-stdb.ts 50` |
| Maincloud behaviour, limits and latency | Not verified | LIVE_CHECKLIST.md step 1 |

## CREAO

| Fact | Found | How |
| --- | --- | --- |
| A `capi_` key on `GET https://developer.creao.ai/v1/agents` | 401. The key is app-scoped, as the docs say. | `npx tsx scripts/env-check.ts` (writes docs/ENV_STATUS.md) |
| Account path request and response shapes | Not verified live. Implemented from CREAO's API Trigger and API Paths docs; tested against a stand-in server. | `worker/test/creao.test.ts` |
| App path shapes (`inputs`, `webhookUrl`, `/runs/{id}`) | Not verified live (no app ids in the session) | same |
| Where the run share link appears | Not verified (booth question) | README table says `<fill in>` |
| Can a saved agent read image URLs? Which models can it call? | Not verified (booth question). The design assumes yes; frame URLs are HMAC-signed for 2 hours. | `worker/src/video.ts` `signPath` |
| How API Trigger `inputs` reach the agent | Not verified (booth question) | the agents' first prompt line may need adjusting |
| How to continue a conversation (`conversation_id` / `threadId`) | Not verified. Both ids are stored on `agent_run` when returned. | `worker/src/creao.ts` |

## Factory Droid SDK (`@factory/droid-sdk` 0.10.0)

| Fact | Found | How |
| --- | --- | --- |
| Session options, permission callback and tool detail types | Read from the installed package's `.d.ts`; `worker/src/lab.ts` type-checks against them | `npm run typecheck` |
| The permission callback can cancel creates, edits, patches, shell commands and MCP tools | The decision function `decideTool` is unit tested on each case | `worker/test/lab-fence.test.ts` |
| A real session streams messages | Yes (laptop, 2026-10-24, droid 0.249.0): `assistant`, `tool_call`, `tool_result` and `result` messages arrive; `session.stream()` can be called again on the same session to continue the conversation (the reviewer's "nudges") | `worker/src/review/session.ts`, `worker/cases/<id>/droid.log` |
| Droid batches tool calls in a `Script` | Yes. The permission request then has `details.type === 'script'` with `calls: [{ toolName, toolInput, confirmation }]`, one entry per call the harness found that needs confirmation, each with the direct confirmation details (`exec` with `fullCommand`, `mcp_tool` with `serverName`/`toolName`). Read-only scripts never reach the handler. | `worker/src/review/fence.ts` `decideCaseTool` case 'script'; `worker/test/review-fence.test.ts` |
| Tool surface with `autonomyLevel: Off` | Execute, Glob, Grep, LS, Read, Skill, TodoWrite, ToolSearch (+ Script, WaitForScript). **No Create, Edit or ApplyPatch**: Droid writes files through `Execute` (`cat > work/x <<'EOF'`), which the permission handler sees. | probe session, `.stdb/probe-tools.ts` (not committed) |
| Tool surface with `autonomyLevel: Low` | Adds `ApplyPatch`, and **file writes do not call the permission handler** at all. The reviewer therefore stays on `Off`. | same probe |
| `createSdkMcpServer` tools are callable from a session | Yes: `vouch-case___<tool>` appears after Droid's `ToolSearch`; results flow back; the server runs in the worker process and writes rows through reducers | `worker/src/review/case-tools.ts` |
| `toolExecutionMode: 'direct_only'` | Exists in the protocol schemas but is not an option of `createSession` in SDK 0.10.0 | `node_modules/@factory/droid-sdk/dist/node.d.ts` |
| "Tool execution cancelled by user" ends Droid's turn | Yes. After a fence cancel the model stops; the reviewer sends a follow-up message in the same session listing what was refused and what is still missing (at most 2) | `worker/src/review/session.ts` |

## ffmpeg 6.1.1

| Fact | Found | How |
| --- | --- | --- |
| Scene-change sampling `select='gt(scene,0.3)'` | Works. The worker reads `pts_time` from `showinfo` on stderr, then grabs frames by time with `-ss`, always including the first and last second. | `worker/src/video.ts` `frameTimes` |
| dHash from `scale=9:8:flags=area,format=gray` raw output | Works. A re-encoded copy matches within Hamming distance 6, and a different video does not. | `worker/test/video.test.ts` |
| A corrupt file and a clip under 4 s | `ffprobe` fails or reports a short duration, and the upload answers 422 with a reason | `qa/videos/V12-short.mp4`, `V13-corrupt.mp4` |

## react-globe.gl

| Fact | Found | How |
| --- | --- | --- |
| Prop names in the spec (`pointsData` with `pointsMerge`) | Changed. 10,000 agents render through the `particlesData` layer (`particlesList`, `particlesColor`, `particlesSize`). Businesses use `htmlElementsData`; land uses `hexPolygonsData`; the Observatory uses `hexBinPointsData`. Clicks go through `onGlobeClick` plus a JavaScript grid index. | `web/components/world/globe.tsx` |
| `hexPolygonsData` with the Natural Earth 110m countries | One polygon made h3 `polygonToCells` throw. Countries are now validated with h3-js when the GeoJSON is built. | `web/public/geo/countries-110m.geojson` |

## Next.js 16.4.3

| Fact | Found | How |
| --- | --- | --- |
| Breaking changes from older versions | Read in `node_modules/next/dist/docs/`. `cacheComponents` is not used (client-side live data); `useParams` in a client component needs a Suspense boundary on the page. | `web/app/claim/[id]/page.tsx` |
