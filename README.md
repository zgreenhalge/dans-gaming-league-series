# Dan's Gaming League Series

A stat tracker for DGLS — a **CS2 Wingman league** played in the Individual Rotating Mixer format. Because teammates rotate randomly every week, standard win/loss records are misleading. This platform surfaces individual skill through rate-based metrics, primarily **ADR (Average Damage per Round)**.

> New here? See [`GLOSSARY.md`](./GLOSSARY.md) for a rundown of DGLS-specific terms (gauntlet, H2H, faction, RWR, veto, etc.) and a map of where each concept lives in the code, [`RECIPES.md`](./RECIPES.md) for step-by-step patterns on common changes (new stat, new page, new query helper), and [`VISUAL_CONVENTIONS.md`](./VISUAL_CONVENTIONS.md) for the shared hover/glow/accent CSS system.

## Tech Stack

- **Frontend:** Next.js 16 (App Router, TypeScript, Tailwind CSS)
- **Backend/Database:** Supabase (PostgreSQL, REST API, DB views)
- **Auth:** NextAuth.js with Steam OpenID
- **Deployment:** Vercel (frontend) + Supabase cloud (DB)

## Getting Started

```bash
npm install
npm run dev   # http://localhost:3000
```

Other useful commands:

```bash
npm run build   # production build (also type-checks)
npm run lint    # ESLint
```

## Environment Variables

Create `.env.local` at the repo root:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (browser-safe, read-only in practice) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — used by server-side API routes only, never sent to the client |
| `NEXTAUTH_URL` | Full base URL, e.g. `http://localhost:3000` |
| `NEXTAUTH_SECRET` | Secret for signing session tokens (any random string locally) |
| `STEAM_API_KEY` | Steam Web API key — fetches player avatars/nicknames |
| `CRON_SECRET` | Bearer token checked by the Vercel cron endpoint |

**Development shortcut:** When `NODE_ENV=development`, two mock login buttons appear (`Dev: Zach` / `Dev: Dan`) that skip Steam auth entirely and sign you in as a known player. You do not need `STEAM_API_KEY` or `NEXTAUTH_URL` for local dev if you use these.

## Routes

| Path | Page |
|---|---|
| `/` | Home — active/upcoming seasons + current week's matches |
| `/seasons/[id]` | Season hub — leaderboard + weekly schedule (or gauntlet bracket) |
| `/matches/[id]` | Match detail — veto banner, scoreboards, score entry |
| `/players` | Player index |
| `/players/[id]` | Player profile — career stats + per-season breakdown + match log |
| `/statistics` | Cross-season career leaderboard + gauntlet stats |
| `/maps` | Map index — pick/ban/skip counts per map |
| `/maps/[slug]` | Map detail — match history + per-player stats on that map |

## Auth System

Players authenticate via **Steam OpenID**. The flow:

1. User clicks "Sign in with Steam" → `/api/auth/steam` redirects to Steam
2. Steam bounces back to `/api/auth/steam/callback` which validates the response, mints a short-lived signed token, and redirects to `/auth/steam`
3. The `/auth/steam` page calls NextAuth's `signIn("steam-credentials", { token })` to establish a session
4. On first login a `RegisterModal` appears — the player links their Steam account to their existing player record (or creates a new one)

Once linked, `session.user.playerId` is set. Admin players (`players.is_admin = true`) get elevated permissions: editing submitted scores, clearing pick/ban steps, and setting season start dates.

## API Routes (Mutation Endpoints)

All mutation routes require a valid session. Most require the caller to be in the match or an admin.

| Method | Path | Description |
|---|---|---|
| `PATCH` | `/api/matches/[id]/veto` | Submit a single pick/ban step |
| `PATCH` | `/api/matches/[id]/score` | Submit final score + player stats |
| `PATCH` | `/api/matches/[id]/schedule` | Set a match's scheduled time |
| `POST` | `/api/matches/[id]/screenshot` | Upload a scoreboard screenshot to Supabase Storage |
| `PATCH` | `/api/seasons/[id]/start-date` | Set season start date (admin only) |
| `GET/POST` | `/api/players/register` | List unlinked players / link a Steam account to a player record |
| `GET` | `/api/cron/refresh-steam` | Refresh Steam avatars/nicknames for all linked players (Vercel cron) |

## Database

Five tables + one view in Supabase (`public` schema). RLS is **off** on all tables — do not enable it without writing policies first.

### Tables

| Table | Purpose |
|---|---|
| `seasons` | One row per season. Key fields: `name`, `status` (`UPCOMING`/`ACTIVE`/`COMPLETED`), `is_gauntlet` (bool), `start_date`, `map_pool` (text[]), `target_win_rounds`, `buy_in_amount` |
| `weeks` | Linked to `seasons`. Has `week_number` and `bye_player_id` (who sits out that week) |
| `matches` | Linked to `weeks`. Veto fields: `shirts_ban`, `shirts_ban2`, `skins_ban1`, `skins_ban2`, `shirts_pick`, `picked_map`, `skins_starting_side`. Also: `final_score`, `is_playoff_game`, `scheduled_at`, `screenshot_url_front/back`, `notes` |
| `players` | Global player registry. Unique `name`. Steam fields: `steam_id`, `steam_nickname`, `steam_avatar_url`, `steam_refreshed_at`. Admin flag: `is_admin` |
| `player_match_stats` | Per-player per-match: `faction` (`SHIRTS`/`SKINS`), K/A/D, `damage`, `adr`, `rounds_played`, `rounds_won`, `is_win` |

### View: `player_season_leaderboard`

Pre-aggregated per (player, season) — use this for leaderboard rendering, never compute it client-side. Filters out `is_playoff_game = true` rows. Does **not** expose `total_assists` or `total_rounds_won` — those are augmented in `getPerPlayerSeasonStats()` by reading `player_match_stats` directly.

### Gauntlet Seasons

Seasons with `is_gauntlet = true` use a different format:
- Weeks map to **rounds** in a bracket
- Each player submits their own ban simultaneously (no turn order)
- 4 total bans (2 per team) → remaining map is auto-picked
- All gauntlet matches have `is_playoff_game = true`, so they're excluded from the regular leaderboard view
- Stats are computed directly from `player_match_stats` in `getGauntletStats()` / `getGauntletSeasonLeaderboard()`

## Data Ingestion

Historical season data in `ingestion/` is a Python pipeline that reads CSV exports and writes to Supabase. It uses the **service_role key** for writes. See `ingestion/README.md` for setup and commands.

## Maps

League plays on CS2 Wingman community workshop maps (not the official active-duty pool). Map images live in `public/maps/`. To add a new map:
1. Drop a `.jpg` into `public/maps/<slug>.jpg`
2. Add an entry to the `MAP_IMAGES` record in `src/lib/maps.ts`

## Deployment

Vercel auto-detects the Next.js project from the repo root — no `vercel.json` overrides needed for the build. Set all env vars in Vercel project settings (Production + Preview + Development).

A cron job in `vercel.json` runs `/api/cron/refresh-steam` daily at 04:00 UTC to keep Steam avatars/nicknames current.
