# Architecture

System reference for DGLS — routes, auth, the mutation API, the database schema, and deployment.
For domain vocabulary see [`glossary.md`](./glossary.md); for stat formulas see
[`calculations.md`](./calculations.md); for the demo pipeline see
[`demo-ingestion.md`](./demo-ingestion.md).

## Tech Stack

- **Frontend:** Next.js 16 (App Router, TypeScript, Tailwind CSS)
- **Backend/Database:** Supabase (PostgreSQL, REST API, DB views)
- **Auth:** NextAuth.js with Steam OpenID
- **Demo storage:** Cloudflare R2 (S3-compatible) for uploaded `.dem` files
- **Deployment:** Vercel (Next.js frontend + a Python function for the EHOG recompute) + Supabase cloud (DB)

## Routes (pages)

| Path | Page |
|---|---|
| `/` | Home — active/upcoming seasons + current week's matches |
| `/seasons` | Season index — all seasons (regular + gauntlet) |
| `/seasons/[id]` | Season hub — leaderboard + weekly schedule (or gauntlet bracket) |
| `/matches/[id]` | Match detail — veto banner, scoreboards, score entry, demo upload |
| `/players` | Player index |
| `/players/[id]` | Player profile — career stats + per-season breakdown + match log |
| `/statistics` | Cross-season career leaderboard + gauntlet stats |
| `/maps` | Map index — pick/ban/skip counts per map |
| `/maps/[slug]` | Map detail — match history + per-player stats on that map |
| `/admin` | Admin hub — links to admin tools (linked from the Topbar when `session.user.isAdmin`) |
| `/admin/jobs` | Admin background-jobs dashboard — every `background_jobs` row across all three pipelines (`demo_ingest`, `replay_extract`, `radar_build`) with warnings/quarantine flags and per-type actions: confirm/re-parse/dismiss for demo, retry for replay/radar (see [`hosting.md`](./hosting.md)) |
| `/admin/servers` | Admin server console — shared DatHost server status + teardown (see [`hosting.md`](./hosting.md)) |
| `/admin/matches` | Admin match console — search a match to reschedule, clear/redo its pick-ban, or toggle the feature flag (reuses the match-page editors; score/stats editing stays on the match page) |
| `/admin/seasons/new` | Create a new season (admin only) |
| `/auth/steam` | Steam auth landing — completes `signIn()` after the OpenID bounce |

`/career-stats` is a permanent redirect to `/statistics`, not a standalone page.

## Auth System

Players authenticate via **Steam OpenID**. The flow:

1. User clicks "Sign in with Steam" → `/api/auth/steam` redirects to Steam
2. Steam bounces back to `/api/auth/steam/callback`, which validates the response, mints a short-lived signed token, and redirects to `/auth/steam`
3. The `/auth/steam` page calls NextAuth's `signIn("steam-credentials", { token })` to establish a session
4. On first login a `RegisterModal` appears — the player links their Steam account to their existing player record (or creates a new one)

Once linked, `session.user.playerId` is set. Admin players (`players.is_admin = true`) get elevated permissions: editing submitted scores, clearing pick/ban steps, and setting season start dates. `is_admin` is carried on the session token as `session.user.isAdmin` (backfilled into existing sessions on their next request), which gates the Topbar's admin-hub link; admin **pages** still re-check `isPlayerAdmin` server-side.

**Development shortcut:** When `NODE_ENV=development`, two mock login providers (`dev-zach-mock` / `dev-dan-mock`) appear that skip Steam auth entirely and sign you in as a known player. No `STEAM_API_KEY` needed locally.

## API Routes (mutation endpoints)

Most mutation routes require a valid session (caller in the match or an admin). The DatHost/MatchZy
hosting + ingestion routes are their own subsystem — see [`hosting.md`](./hosting.md); the machine-auth
ones (`matchzy-config`, `ingest/notify`) are called by the server/Worker, not a browser.

| Method | Path | Description |
|---|---|---|
| `PATCH` | `/api/matches/[id]/veto` | Submit a single pick/ban step (auto-provisions the server on completion) |
| `PATCH` | `/api/matches/[id]/score` | Submit final score + player stats (tears down the server) |
| `PATCH` | `/api/matches/[id]/schedule` | Set a match's scheduled time |
| `PATCH` | `/api/matches/[id]/feature` | Toggle a match's `is_feature_match` flag (admin only) |
| `POST` | `/api/matches/[id]/demo/upload-url` | Mint a presigned Cloudflare R2 URL to upload a `.dem` file |
| `POST` | `/api/matches/[id]/demo/parse` | Parse the uploaded demo into match + sabremetric stats (see [`demo-ingestion.md`](./demo-ingestion.md)) |
| `GET/DELETE` | `/api/matches/[id]/demo/result` | Read / dispose the staged auto-ingest result ([`hosting.md`](./hosting.md)) |
| `POST` | `/api/matches/[id]/demo/dispatch` | Re-parse the demo already in R2 (manual counterpart to `ingest/notify`) |
| `GET/POST` | `/api/matches/[id]/server/{status,provision,teardown}` | Per-match DatHost server lifecycle ([`hosting.md`](./hosting.md)) |
| `GET` | `/api/matches/[id]/matchzy-config` | Machine-auth MatchZy config (`matchzy_loadmatch_url` target) |
| `POST` | `/api/ingest/notify` | Machine-auth: demo landed → record job, dispatch parse, tear down |
| `POST` | `/api/matches/[id]/replay/dispatch` | (Re)trigger the replay Action ([`replay.md`](./replay.md)) |
| `POST` | `/api/maps/[slug]/radar/dispatch` | (Re)trigger the radar-build Action for a map (admin only; [`replay.md`](./replay.md)) |
| `PATCH` | `/api/seasons/[id]/start-date` | Set season start date (admin only) |
| `GET/POST` | `/api/players/register` | List unlinked players / link a Steam account to a player record |
| `GET` | `/api/cron/refresh-steam` | Refresh Steam avatars/nicknames for all linked players (Vercel cron; see below) |

## Database

Supabase (`public` schema). RLS is **off** on all tables — do not enable it without writing policies first. Types mirroring these shapes live in `src/lib/types.ts`.

### Tables

| Table | Purpose |
|---|---|
| `seasons` | One row per season. Key fields: `name`, `status` (`UPCOMING`/`ACTIVE`/`COMPLETED`), `is_gauntlet` (bool), `start_date`, `map_pool` (text[]), `target_win_rounds`, `buy_in_amount` |
| `weeks` | Linked to `seasons`. Has `week_number` and `bye_player_id` (who sits out that week) |
| `matches` | Linked to `weeks`. Veto fields: `shirts_ban`, `shirts_ban2`, `skins_ban1`, `skins_ban2`, `shirts_pick`, `picked_map`, `skins_starting_side`. Also: `final_score`, `is_playoff_game`, `scheduled_at`, `screenshot_url_front/back`, `notes`. Hosting (see [`hosting.md`](./hosting.md)): `server_state`, `dathost_server_id`, `connect_string`, `server_started_at` |
| `players` | Global player registry. Unique `name`. Steam fields: `steam_id`, `steam_nickname`, `steam_avatar_url`, `steam_refreshed_at`. Admin flag: `is_admin` |
| `player_match_stats` | Per-player per-match basics: `faction` (`SHIRTS`/`SKINS`), K/A/D, `damage`, `adr`, `rounds_played`, `rounds_won`, `is_win` |
| `player_match_sabremetrics` | Demo-derived advanced stats, one row per `player_match_stats` row (FK `player_match_stats_id`): CT/T side splits, opening duels, KAST, clutches, utility, objectives. Written only when a demo is parsed. See [`demo-ingestion.md`](./demo-ingestion.md). |
| `player_rating_history` / `player_current_ratings` | EHOG skill-rating storage (μ/σ history + current standings). Written by the EHOG recompute. See [`ehog.md`](./ehog.md). |
| `background_jobs` | Background-job state machine, one row per (`job_type`, `match_id`). `job_type` is `replay_extract` ([`replay.md`](./replay.md)) or `demo_ingest` ([`hosting.md`](./hosting.md)); tracks `status`/`stage`/`error_message` + GitHub Action run refs. |

### View: `player_season_leaderboard`

Pre-aggregated per (player, season) — use this for leaderboard rendering, never compute it client-side. Filters out `is_playoff_game = true` rows. Does **not** expose `total_assists` or `total_rounds_won` — those are augmented in `getPerPlayerSeasonStats()` by reading `player_match_stats` directly.

### Gauntlet seasons

Seasons with `is_gauntlet = true` use a different format:
- Weeks map to **rounds** in a single-elimination bracket
- Each player submits their own ban simultaneously (no turn order); 4 total bans (2 per team) → remaining map is auto-picked
- All gauntlet matches have `is_playoff_game = true`, so they're excluded from the regular leaderboard view
- Stats are computed directly from `player_match_stats` in `getGauntletStats()` / `getGauntletSeasonLeaderboard()`

See [`glossary.md`](./glossary.md) for the full gauntlet semantics and [`calculations.md`](./calculations.md#canonical-gauntlet-ranking) for the canonical ranking.

## Data Ingestion

Two ingestion paths populate match stats:

- **Historical CSV** — `ingestion/` is a Python pipeline that reads CSV exports and writes to Supabase using the **service_role key**. Not deployed; runs locally. See `ingestion/README.md`.
- **CS2 demo files** — uploaded per match through the site and parsed server-side into basic stats (`player_match_stats`) and advanced sabremetrics (`player_match_sabremetrics`). See [`demo-ingestion.md`](./demo-ingestion.md).

## Maps

League plays on CS2 Wingman community **workshop** maps (not the official active-duty pool). Map images live in `public/maps/`. To add a new map:
1. Drop a `.jpg` into `public/maps/<slug>.jpg`
2. Add an entry to the `MAP_IMAGES` record in `src/lib/maps.ts`

Map names in the DB are user-typed strings — always compare case-insensitively (`.toLowerCase()`) and use `mapSlug()` from `src/lib/maps.ts` for URL segments.

## Deployment

Vercel auto-detects the Next.js project from the repo root. Set all env vars in Vercel project settings (Production + Preview + Development). See the env var table in the root [`README.md`](../README.md).

`vercel.json` carries two non-default pieces of config:

- **Cron** — `GET /api/cron/refresh-steam` runs daily at `0 4 * * *` (04:00 UTC) to refresh Steam avatars/nicknames. The route is `CRON_SECRET`-bearer-gated and batches players through the Steam `GetPlayerSummaries` API 100 at a time.
- **Python function** — `api/ehog/recompute.py` is deployed on the `@vercel/python` runtime with `ehog/**` bundled via `includeFiles`. It runs the EHOG full recompute after a score is submitted. See [`ehog.md`](./ehog.md).
