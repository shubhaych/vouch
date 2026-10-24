# Environment status

Written by `npx tsx scripts/env-check.ts` on 2026-10-24T12:30:50.090Z. Key values are never printed.

| Service | Status | Detail | Next step |
| --- | --- | --- | --- |
| SpacetimeDB | live | ws://localhost:3011/vouch: day 500, 10000 agents, running=true |  |
| CREAO | failed | capi_ (app-scoped key): GET /v1/agents answered 401; app path needs per-seat app ids (0/3 set) | `set CREAO_<SEAT>_APP_ID (and per-seat capi_ keys), or use one cr_sk_ account key` |
| Factory Droid | missing | FACTORY_API_KEY not set; droid CLI not installed | `install the droid CLI and set FACTORY_API_KEY on the worker laptop` |
| ffmpeg | live | ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers |  |
