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
| `/players/[id]` | Player profile — career stats + per-season breakdown + match log. Shows a "Formerly …" line if the player has past names. The viewer can rename themself in place here (`PlayerNameEditor`) if it's their own profile |
| `/statistics` | Cross-season career leaderboard + gauntlet stats |
| `/maps` | Map index — pick/ban/skip counts per map |
| `/maps/[slug]` | Map detail — match history + per-player stats on that map |
| `/admin` | Unified admin console (linked from the Topbar when `session.user.isAdmin`) — a standalone Server panel (shared DatHost server status/controls, see [`hosting.md`](./hosting.md)), an Activity feed (every `background_jobs` row across all three pipelines plus live `ops_errors`, tiered Errored / In Progress / Completed / History), and Manage (Match/Player/Season — reschedule/veto/feature-toggle, rename/admin/Steam-link/EHOG recompute, season creation + gauntlet build/seed/reset + "go live"). The former separate admin pages (`jobs`, `matches`, `players`, `servers`, `ops-errors`, `seasons/new`, `seasons/gauntlet`) now redirect here via `?section=`/`&type=` |
| `/admin/seasons/gauntlet/manual/[id]` | Manual gauntlet pod editor — a full drag/pick/validate/save flow, kept as its own route rather than folded into the console |
| `/admin/seasons/schedule/[id]` | Regular-season Schedule Editor — hand-edit any match slot, then confirm. Generation itself happens on `/seasons/[id]` (`SeasonScheduleEntryPoint`, shown to admins while `UPCOMING`): if no schedule draft exists yet, that's where the doubleheader-policy choice and "Generate Schedule" live, landing here immediately after; once one exists, that same spot is just an "Edit Schedule" link here |
| `/auth/steam` | Steam auth landing — completes `signIn()` after the OpenID bounce |

`/career-stats` is a permanent redirect to `/statistics`, not a standalone page.

## Auth System

Players authenticate via **Steam OpenID**. The flow:

1. User clicks "Sign in with Steam" → `/api/auth/steam` redirects to Steam
2. Steam bounces back to `/api/auth/steam/callback`, which validates the response, mints a short-lived signed token, and redirects to `/auth/steam`
3. The `/auth/steam` page calls NextAuth's `signIn("steam-credentials", { token })` to establish a session
4. On first login a `RegisterModal` appears. If the URL carries an admin-issued claim link (`?claim=<token>`, minted via `GET /api/players/[id]/claim-link` and handed out of band), the player confirms and links their Steam account to that specific, already-known player record; otherwise they create a new one. Self-service linking to an arbitrary existing record is not possible — the claim token is what proves the player was actually handed that record.

Once linked, `session.user.playerId` is set. Admin players (`players.is_admin = true`) get elevated permissions: editing submitted scores, clearing pick/ban steps, and setting season start dates. `is_admin` is carried on the session token as `session.user.isAdmin`, re-derived from the DB on every session read rather than cached for the JWT's lifetime — a demotion (or promotion) takes effect on that player's very next request. It gates the Topbar's admin-console link; `src/app/admin/layout.tsx` is the actual enforcement point for every route under `/admin/**`, so individual admin pages don't repeat the check.

**Development shortcut:** When `NODE_ENV=development`, two mock login providers (`dev-zach-mock` / `dev-dan-mock`) appear that skip Steam auth entirely and sign you in as a known player. No `STEAM_API_KEY` needed locally.

**Discord account linking** is a separate, self-service flow from Steam sign-in — it links an already-authenticated player's Discord user id (`players.discord_id`) rather than establishing the session itself, and never touches the session or JWT. `GET /api/auth/discord/link` (session-gated) redirects to Discord's OAuth2 consent screen with a signed `state` param (`signDiscordLinkState()`/`verifyDiscordLinkState()`, `src/lib/discordLinkState.ts`, same HMAC-signed-token shape as `playerClaim.ts`) naming the calling player; `GET /api/auth/discord/callback` verifies it, exchanges the code, reads the Discord user id via `/users/@me`, and writes `discord_id` — refusing if that id is already linked to a different player. A genuine failure there (as opposed to the player simply declining consent) is recorded to `ops_errors` (`discord_link`) — see "Surfacing best-effort failures" below. `DELETE /api/players/me/discord` is the self-service unlink (mirrors `PATCH /api/players/me/name`'s auth pattern); `PATCH /api/players/[id]` also accepts `discord_id` as an admin override (`null` unlinks, a 17–20 digit snowflake links by hand), the same shape as its existing `steam_id` handling. `DiscordLinkButton.tsx`, shown only on a player's own profile, is the UI for both halves.

**Access-control gates:** session-scoped mutation routes (not `/admin/**` pages, which the layout above covers) delegate to one small dedicated gate file per access shape rather than reimplementing the check inline — `admin-access.ts` (admin-only), `match-access.ts` (admin-or-in-match), `season-roster-access.ts` (admin-or-self). All three return the shared `AccessResult<T>` discriminated union (`src/lib/access-control.ts`): `{ ok: true, ...T }` or `{ ok: false, status, error }`, so a caller's `if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })` works identically regardless of which gate it called. A new permission tier (e.g. a "season commissioner" role) should get its own gate file returning `AccessResult<...>` rather than a bespoke shape. `machine-auth.ts` (shared-secret routes called by the game server, not a browser session) is deliberately not part of this family — see its own docstring.

## API Routes (mutation endpoints)

Most mutation routes require a valid session (caller in the match or an admin). The DatHost/MatchZy
hosting + ingestion routes are their own subsystem — see [`hosting.md`](./hosting.md); the machine-auth
ones (`matchzy-config`, `ingest/matchzy-log`) are called by the game server, not a browser.

| Method | Path | Description |
|---|---|---|
| `PATCH` | `/api/matches/[id]/veto` | Submit a single pick/ban step (auto-provisions the server on completion) |
| `PATCH` | `/api/matches/[id]/score` | Submit final score + player stats (tears down the server; posts a `#match-notifications` Discord alert the first time a match transitions into "played" — see [`hosting.md`](./hosting.md)) |
| `PATCH` | `/api/matches/[id]/schedule` | Set a match's scheduled time |
| `PATCH` | `/api/matches/[id]/feature` | Toggle a match's `is_feature_match` flag (admin only) |
| `POST` | `/api/matches/[id]/demo/upload-url` | Mint a presigned Cloudflare R2 URL to upload a `.dem` file |
| `POST` | `/api/matches/[id]/demo/parse` | Parse the uploaded demo into match + sabremetric stats (see [`demo-ingestion.md`](./demo-ingestion.md)) |
| `GET/DELETE` | `/api/matches/[id]/demo/result` | Read / dispose the staged auto-ingest result ([`hosting.md`](./hosting.md)) |
| `POST` | `/api/matches/[id]/demo/dispatch` | Re-parse the demo already in R2 (manual counterpart to `ingest/matchzy-log`'s auto-dispatch) |
| `GET/POST` | `/api/matches/[id]/server/{status,provision,teardown}` | Per-match DatHost server lifecycle ([`hosting.md`](./hosting.md)) |
| `GET` | `/api/matches/[id]/matchzy-config` | Machine-auth MatchZy config (`matchzy_loadmatch_url` target) |
| `POST` | `/api/ingest/matchzy-log` | Machine-auth: MatchZy remote-log events — `map_result` records the job, dispatches parse, tears down the server; `going_live`/`round_end` feed the live score |
| `POST` | `/api/matches/[id]/replay/dispatch` | (Re)trigger the replay Action ([`replay.md`](./replay.md)) |
| `POST` | `/api/maps/[slug]/radar/dispatch` | (Re)trigger the radar-build Action for a map (admin only; [`replay.md`](./replay.md)) |
| `PATCH` | `/api/seasons/[id]/start-date` | Set season start date (admin only) |
| `PATCH` | `/api/seasons/[id]/status` | Transition a regular season `UPCOMING` → `ACTIVE` ("go live"); best-effort builds its gauntlet shape (admin only) |
| `DELETE` | `/api/seasons/[id]` | Delete an `UPCOMING` regular season outright — refuses if it already has real `weeks`, otherwise clears its `season_players` roster and schedule draft first (admin only) |
| `DELETE` | `/api/ops-errors/[id]` | Dismiss an `ops_errors` row, any entity type (admin only) |
| `POST` | `/api/seasons/[id]/gauntlet/preview` | Compute what building would produce — qualifier count, games, rounds, pod/slot shape — without writing anything (admin only) |
| `POST` | `/api/seasons/[id]/gauntlet` | Create the paired gauntlet season for an active regular season and build its bracket *shape* — unseeded, nothing materialized (admin only) |
| `POST` | `/api/seasons/[id]/gauntlet/seed` | Seed an existing shape from the season's current leaderboard order and materialize round 1 (admin only) |
| `DELETE` | `/api/seasons/[id]/gauntlet` | Reset a gauntlet — deletes it and everything materialized under it; refuses if any match has a score unless `{ force: true }` is passed (admin only) |
| `POST` | `/api/seasons/[id]/gauntlet/pods` | Save the manual pod editor's current draft — creates the paired gauntlet season if needed, then inserts/updates/deletes pods to match (admin only) |
| `POST/DELETE` | `/api/seasons/[id]/players` | Add/remove a player from a season's roster (`season_players`) — admins manage any player, a player can only add/remove themselves; `UPCOMING` only. Best-effort grants/revokes the `@Participants` Discord role (#397) for that one player if they're linked |
| `POST/DELETE` | `/api/seasons/[id]/schedule` | Generate (fully regenerating) or clear a season's schedule draft from its current roster (admin only, `UPCOMING` only) |
| `PATCH` | `/api/seasons/[id]/schedule` | Save a hand-edit to an existing schedule draft — reassigns players within the generated week/match structure (admin only, `UPCOMING` only) |
| `POST` | `/api/seasons/[id]/schedule/confirm` | Materialize a validated schedule draft into real `weeks`/`matches`/`player_match_stats` (admin only, `UPCOMING` only) |
| `PATCH` | `/api/players/[id]` | Edit a player — display name, `is_admin` (can't demote yourself), Steam link (unlink / set SteamID64), or Discord link (unlink / set snowflake id) (admin only) |
| `PATCH` | `/api/players/me/name` | Self-service rename — the caller's own display name only, letters/spaces only, once every 7 days |
| `GET` | `/api/auth/discord/link` | Start the self-service Discord account-linking OAuth2 flow for the signed-in player (session required) |
| `GET` | `/api/auth/discord/callback` | Complete the Discord linking flow — exchanges the code, writes `players.discord_id`, redirects back to the player's profile with a `?discord=` status |
| `DELETE` | `/api/players/me/discord` | Self-service Discord unlink — the caller's own `discord_id` only |
| `POST` | `/api/ehog/recompute/trigger` | Admin-gated "recompute EHOG ratings now" — fires the full rating walk in the background (admin only) |
| `POST` | `/api/players/register` | Link a Steam account to a player record via an admin-issued claim token, or create a new player record |
| `GET` | `/api/players/[id]/claim-link` | Mint a signed claim token for an unlinked player, to hand to them out of band (admin only) |
| `GET` | `/api/cron/refresh-steam` | Refresh Steam avatars/nicknames for all linked players (Vercel cron; see below) |
| `POST` | `/api/discord/interactions` | Discord Interactions endpoint (#396) — Ed25519-verified (`DISCORD_PUBLIC_KEY`), serves `/leaderboard`, `/scheduled`, `/player` slash commands (`src/lib/discord-commands.ts`). Command *definitions* are separate, pushed by `scripts/register-discord-commands.ts` — this route only serves already-registered commands, it doesn't register them |

## Database

Supabase (`public` schema). RLS is **off** on all tables — do not enable it without writing policies first. `src/lib/database.types.ts` is generated directly from the live schema (via the Supabase MCP `generate_typescript_types` tool, or `npx supabase gen types typescript`) and is what both Supabase clients (`src/lib/supabase.ts`, `src/lib/supabase-admin.ts`) type-check every query against — regenerate it after any migration changes a table shape. `src/lib/types.ts` is a separate, hand-written layer of domain types (`LeaderboardRow`, `PlayerMatchStat`, …) shaping query *output*, not to be confused with the generated file.

**Any Supabase MCP tool that mutates state** — `apply_migration`, a non-`SELECT` `execute_sql`, or any project/branch-management tool (`create_project`, `create_branch`, `delete_branch`, `merge_branch`, `rebase_branch`, `reset_branch`, `restore_project`, `pause_project`, `deploy_edge_function`, `confirm_cost`) — **requires the user's explicit approval of that exact command, given at the time it's about to run.** See [`../AGENTS.md`](../AGENTS.md)'s "Supabase changes require live, per-operation approval." Read-only tools (`list_tables`, `get_logs`, `get_advisors`, `search_docs`, `list_migrations`, `list_branches`, `list_extensions`, `list_projects`, `get_project`, `get_organization`, `list_organizations`, `get_cost`, `get_project_url`, `get_publishable_keys`, `list_edge_functions`, `get_edge_function`, `generate_typescript_types`, and a plain-`SELECT` `execute_sql`) don't need it.

### Tables

| Table | Purpose |
|---|---|
| `seasons` | One row per season. Key fields: `name`, `status` (`UPCOMING`/`ACTIVE`/`COMPLETED`/`ARCHIVED`), `is_gauntlet` (bool), `start_date`, `map_pool` (text[]), `target_win_rounds`, `buy_in_amount`. `schedule_draft_locked_at` (nullable) — claimed while a schedule-draft generate/save/delete/confirm is in flight for this season, see below |
| `weeks` | Linked to `seasons`. Has `week_number` and `bye_player_id` (who sits out that week) |
| `season_players` | Explicit roster for a season: `season_id`, `player_id`, `joined_at`, unique per `(season_id, player_id)`. Only meaningful before matches exist — once a season has been played, `player_match_stats` is the source of who actually participated. Read alone via `getSeasonRoster()` (roster editor, schedule generation — both want the raw pre-schedule signup list specifically); `getSeasonParticipants()` unions it with the match-derived membership for callers that need "who's part of the season right now" regardless of stage (the `@Participants` Discord role sync). Mutated through `POST`/`DELETE /api/seasons/[id]/players` (admins manage any player; a player can only add/remove themselves via `requireSeasonRosterAccess()`, `src/lib/season-roster-access.ts`), editable only while the season is `UPCOMING` — enforced atomically by the `season_players_upcoming_only` trigger, which row-locks the parent season and re-checks its status inside the same transaction as the insert/delete, not just by the route's own pre-check |
| `season_schedule_draft_weeks` / `season_schedule_draft_matches` | A regular season's editable schedule draft, generated from `season_players` by `buildRosterSchedule()` (`season-schedule-engine.ts`) and persisted by `generateSeasonScheduleDraft()` (`season-schedule-draft-engine.ts`) via `POST /api/seasons/[id]/schedule`. Mirrors `weeks`/`matches` in shape — `bye_player_id` is singular because `doubleheaderPolicy: 'auto'` caps byes at one per week by construction — but stays in its own tables until confirmed, so generating or hand-editing it never touches real `weeks`/`matches` rows. `season_schedule_draft_matches` uses flat `shirts_player1_id`/`shirts_player2_id`/`skins_player1_id`/`skins_player2_id` columns rather than a normalized slot table, since (unlike a gauntlet pod slot) a draft match slot is always just a player_id, never a placeholder sourced from another match's winner. Read via `getSeasonScheduleDraft()` (existence-only checks use the cheaper `hasSeasonScheduleDraft()`). `validateDraftIntegrity()`/`validateDraftCompleteness()` (`season-schedule-validation.ts`) are the two-tier check hand-edits and confirmation both go through — integrity is hard (structural soundness: no self-paired match, at most 2 appearances/week, a bye player never also plays, every referenced player is on the season's current roster), completeness is soft everywhere except confirmation, which requires both. Hand-editing happens in `SeasonScheduleDraftEditor` (`/admin/seasons/schedule/[id]`) via `PATCH /api/seasons/[id]/schedule` (`saveSeasonScheduleDraft()`). `confirmSeasonScheduleDraft()` materializes a validated draft into real `weeks`/`matches` plus zero-stat placeholder `player_match_stats` rows (same pattern as `materializePod()`) via `POST /api/seasons/[id]/schedule/confirm` — refuses if the season already has real weeks, and leaves the draft rows untouched either way. `generateSeasonScheduleDraft()`/`saveSeasonScheduleDraft()`/`deleteSeasonScheduleDraft()`/`confirmSeasonScheduleDraft()` all claim `seasons.schedule_draft_locked_at` (an atomic conditional UPDATE, same pattern as the self-service rename cooldown) before touching the draft or real schedule tables and release it when done, so two overlapping requests for the same season — including two concurrent confirms — can't interleave their writes or both pass the "not materialized yet" check; a lock older than 60s is treated as free. The first three also refuse with `ScheduleAlreadyMaterializedError` once the season already has real weeks — `season.status === 'UPCOMING'` alone doesn't rule this out, since confirming deliberately leaves status untouched (activation is a separate action), so without this check an admin could keep editing a draft that's already been superseded by a real schedule. Neither `generateSeasonScheduleDraft()` nor `confirmSeasonScheduleDraft()` runs inside a real DB transaction (each is a sequence of several Supabase calls), so a mid-loop failure triggers a best-effort compensating cleanup of whatever that attempt inserted before rethrowing — the draft/schedule ends up either fully done or fully back to its prior state, never stuck half-materialized (which, post-`ScheduleAlreadyMaterializedError`, would otherwise lock an admin out of every normal remediation route). If the cleanup itself fails, `recordOpsError()` (entity type `season`, operation `schedule_generate_cleanup`/`schedule_confirm_cleanup`) surfaces that for manual follow-up. There's no rollback (un-confirming) once a confirm fully succeeds |
| `matches` | Linked to `weeks`. Veto fields: `shirts_ban`, `shirts_ban2`, `skins_ban1`, `skins_ban2`, `shirts_pick`, `picked_map`, `skins_starting_side`. Also: `final_score`, `is_playoff_game`, `scheduled_at`. `pre_match_win_prob` (nullable) — frozen SHIRTS-win probability from the EHOG recompute, paired with `pre_match_win_prob_formula_version`; see [`ehog.md`](./ehog.md) |
| `players` | Global player registry. `name` is unique two ways: a plain (case-sensitive) unique index and `players_name_lower_unique` on `lower(name)`, so "Bob" and "bob" can't coexist. Steam fields: `steam_id` (`players_steam_id_key`, a plain `UNIQUE` constraint — Postgres treats every `NULL` as distinct, so any number of unlinked players can share `NULL` while no two linked ones can share an id), `steam_nickname`, `steam_avatar_url`, `steam_refreshed_at`. `discord_id` (nullable, `players_discord_id_key`, same plain-`UNIQUE`-over-nullable shape) — linked via the self-service OAuth2 flow or an admin override, see "Discord account linking" above; no nickname/avatar cache alongside it. Both constraints are the backstop for their route-level pre-checks (`isDiscordIdTaken()`, the inline `steam_id` clash check) racing a concurrent write for the same id — every write path maps the resulting `23505` to the same "already taken" response the pre-check itself would give, not a generic error. Admin flag: `is_admin`. `seed_ehog` (nullable) — admin-configured starting EHOG rating for a known new player; see [`ehog.md`](./ehog.md). `name_changed_at` (nullable) — when `name` last changed, by either rename route; the self-service cooldown's atomic-update gate (below), not just an audit field |
| `player_name_history` | One row per rename: `player_id`, `old_name`, `new_name`, `changed_at`. Written by both `PATCH /api/players/[id]` (admin) and `PATCH /api/players/me/name` (self-service) via `recordNameChange()`; purely an audit trail — read via `getPlayerNameHistory()` for the "Formerly …" line on a player's public profile. The once-a-week self-service cooldown is enforced separately, off `players.name_changed_at` |
| `player_match_stats` | Per-player per-match basics: `faction` (`SHIRTS`/`SKINS`), K/A/D, `damage`, `adr`, `rounds_played`, `rounds_won`, `is_win` |
| `player_match_sabremetrics` | Demo-derived advanced stats, one row per `player_match_stats` row (FK `player_match_stats_id`): CT/T side splits, opening duels, KAST, clutches, utility, objectives. Written only when a demo is parsed. See [`demo-ingestion.md`](./demo-ingestion.md). |
| `player_match_weapon_stats` / `player_match_economy_stats` | Demo-derived shot/accuracy/damage/rounds breakdowns, several rows per `player_match_stats` row (FK `player_match_stats_id`, unique with `weapon_category`/`economy_type`) — one per weapon category (`pistol`/`smg`/`rifle`/`sniper`/`shotgun`) or round-economy tier (`eco`/`force_buy`/`full_buy`). Written only when a demo is parsed. See [`demo-ingestion.md`](./demo-ingestion.md). |
| `player_rating_history` / `player_current_ratings` | EHOG skill-rating storage (μ/σ history + current standings). Written by the EHOG recompute. See [`ehog.md`](./ehog.md). |
| `background_jobs` | Background-job state machine, one row per (`job_type`, `match_id`/`map_id`). `job_type` is `replay_extract`/`radar_build` ([`replay.md`](./replay.md)), `demo_ingest` ([`hosting.md`](./hosting.md)), or `ehog_recompute` ([`ehog.md`](./ehog.md)); tracks `status`/`stage`/`error_message` + GitHub Action run refs. |
| `gauntlet_pods` | One row per pod in a gauntlet bracket: `season_id`, `round_number` (== `weeks.week_number`), `pod_index`, `advance_rule` (`single`/`wildcard`), `is_final`, `week_id`, `match1_id`/`match2_id` (set once materialized). Frozen at bracket creation — nothing re-derives it. |
| `gauntlet_pod_slots` | The 4 slots (`slot_index` 0-3) feeding each pod: `source_kind` (`seed`/`pod`), `source_seed` (for seed slots) or `source_pod_id` (the advancement edge, for pod slots), and the resolved `player_id`. |
| `ops_errors` | Generic best-effort-operation-failure surface: `entity_type` (`season`/`match`/`system`), `entity_id` (`0` for the `system` singleton), `operation`, `message`, `occurred_at`, `dismissed_at` (`null` while live). Unique on `(entity_type, entity_id, operation)`. See "Surfacing best-effort failures". |
| `scrim_sessions` | Singleton table (`id` pinned to `1`) tracking the one active scrim, if any: `started_by` (owner, for the stop-authorization check), `warned_15`/`warned_10`/`warned_5` (pre-match warning one-shots). See [`hosting.md`](./hosting.md)'s Scrims section. |
| `live_match_score` | One row per in-progress match (`match_id` PK): `shirts_score`, `skins_score`, `round` (nullable). Written by `going_live`/`round_end`/`map_result` events, read live via Supabase Realtime by `MatchScoreHero`/`LiveMatchTicker`. Deleted by `pullDemoAndClearLiveScore()` (`liveScore.ts`), which both `demo-ingest.ts` and `replay-extract.ts` call instead of `ensureDemoInR2()` directly so the demo pull always clears the row — a demo existing is proof the match is over regardless of whether its score has been derived/confirmed yet; `writeMatchScore()` also clears it as a fallback for a score confirmed with no demo ever pulled — see [`hosting.md`](./hosting.md). |
| `match_server_state` | One row per match (`match_id` PK), created on first provision — no row means `idle`. Transient DatHost server-lifecycle state (`server_state`, `dathost_server_id`, `connect_string`, `server_started_at`, `teardown_at`), kept off the core `matches` row since it's orchestration state, not match data. See [`hosting.md`](./hosting.md)'s Server-state machine section. |
| `match_discord_state` | One row per match (`match_id` PK, `ON DELETE CASCADE`), created on first use — no row means neither has happened yet. Transient Discord-integration bookkeeping, same "not match data" reasoning as `match_server_state`: `reminder_sent_at` (nullable) is the one-shot guard for the 1-hour-out reminder (#395); `thread_id` (nullable) is the weekly match-thread's Discord thread id (#398), letting the weekly job tell "already has a thread" from "needs one." |

### View: `player_season_leaderboard`

Pre-aggregated per (player, season) — use this for leaderboard rendering, never compute it client-side. Filters out `is_playoff_game = true` rows. Does **not** expose `total_assists` or `total_rounds_won` — those are augmented in `getPerPlayerSeasonStats()` by reading `player_match_stats` directly.

### Gauntlet seasons

Seasons with `is_gauntlet = true` use a different format:
- Weeks map to **rounds** in a single-elimination bracket
- Each player submits their own ban simultaneously (no turn order); 4 total bans (2 per team) → remaining map is auto-picked
- All gauntlet matches have `is_playoff_game = true`, so they're excluded from the regular leaderboard view
- Stats are computed directly from `player_match_stats` in `getGauntletStats()` / `getGauntletSeasonLeaderboard()`

See [`glossary.md`](./glossary.md) for the full gauntlet semantics and [`calculations.md`](./calculations.md#canonical-gauntlet-ranking) for the canonical ranking.

### Gauntlet bracket scheduling

`buildGauntletBracket(N)` in `src/lib/gauntlet-bracket.ts` is a pure, deterministic function of the
qualifier field size — it has a literal worked shape for every `N` from 4 to 20 (unit-tested against
the full reference table in `gauntlet-bracket.test.ts`) and throws for anything outside that range
rather than guessing an unspecified shape. Its output is a plan of **pods** — 4 players playing 2
games with two distinct partner pairings, guaranteeing exactly one 2-0 and one 0-2 result — each
tagged `single` (only the 2-0 survives) or `wildcard` (only the 0-2 is eliminated).

Building and seeding a bracket are two separate steps, because the shape only depends on the
qualifier *count*, not on who qualified:

1. **`POST /api/seasons/[id]/gauntlet/preview`** takes a regular season's id and returns what
   building would produce — qualifier count, games, rounds, and the full pod/slot shape
   (`buildGauntletBracket()` plus `planToPreviewPods()` in `src/lib/gauntlet-bracket.ts`) — without
   writing anything. `buildGauntletBracket()` is pure, so this is just that plan plus a read of the
   current roster size; `planToPreviewPods()` renders it into the same shape
   `getGauntletBracketShape()` reads back from the database (synthesizing sequential pod ids, since
   none exist yet) so `GauntletBracketDiagram` can render it identically. `CreateGauntletForm` calls
   this first and shows the diagram behind a confirm/cancel choice before anything is persisted.
2. **`POST /api/seasons/[id]/gauntlet`** takes a regular season's id, creates the paired
   `"Season N Gauntlet"` season row, and persists the bracket *shape* — every `gauntlet_pods` /
   `gauntlet_pod_slots` row, but every slot's `player_id` left null (`persistBracketShape()` in
   `src/lib/gauntlet-engine.ts`). `N` comes from the roster (`getSeasonLeaderboard()`'s row count,
   which includes zero-stat unplayed players), not from standings — so this can run as soon as the
   season's full match schedule exists, well before the regular season is complete. Nothing is
   materialized; nothing is playable yet. Runs automatically when a season goes live (see below);
   this route is the manual/admin equivalent — and what `CreateGauntletForm` calls once the admin
   confirms the preview.
3. **`POST /api/seasons/[id]/gauntlet/seed`** takes the same regular season's id, reads its
   *current* `getSeasonLeaderboard()` order (seed 1 = leader), fills in every seed-sourced slot's
   `player_id`, and materializes every pod that becomes fully filled as a result — round 1, plus any
   all-bye pod (`seedBracket()`). Refuses if the bracket is already seeded (re-seeding would desync
   `gauntlet_pod_slots` from matches already materialized under the prior seeding), or if the roster
   has drifted since the shape was built (its seed-slot count no longer matches the season's current
   player count) — reset and rebuild instead. Runs automatically once the regular season is fully
   played (see below); this route is the manual/admin equivalent, for seeding on demand.

Both steps are also exposed as reusable functions — `tryBuildGauntletShape()` and
`trySeedGauntlet()` — returning a discriminated result (`built`/`already-exists`/`not-eligible`,
`seeded`/`no-shape`/`already-seeded`/`drift`) rather than throwing or coding an HTTP response, so
both the admin routes and the automatic triggers below share one implementation.

Later rounds materialize automatically as their pod resolves, via a non-fatal hook
(`resolveAndPropagate()`) appended to `PATCH /api/matches/[id]/score` after the score commit; both it
and the seeding step share a `materializeIfReady()` helper that only materializes a pod once all four
of its slots are filled and it hasn't already been. A pod's `advance_rule` and `is_final` also drive
the "pod stakes" label shown on the round list and match page (`GAUNTLET_POD_STAKES_LABEL` in
`src/lib/util.ts`). The score route runs `checkGauntletCompletion()` (below) only after
`resolveAndPropagate()` settles, in the same hook — running them as unordered independent hooks would
let completion see an incomplete round as "everything played" and archive before the final round
materializes.

**Bracket diagram.** `getGauntletBracketShape()` in `src/lib/queries/gauntlet.ts` reads `gauntlet_pods`/
`gauntlet_pod_slots` directly rather than matches, so — unlike `getGauntletRounds()`, which returns
nothing until a pod's matches materialize — it also covers the persisted-but-unseeded shape.
`GauntletBracketDiagram` (`src/components/GauntletBracketDiagram.tsx`) renders it: one box per pod,
columns by round, with a connector line from a pod to every downstream pod a survivor's
`source_pod_id` traces back to it — solid once resolved, dashed while still pending. It appears
everywhere a bracket shape exists to look at: inline in `CreateGauntletForm` after
`POST /api/seasons/[id]/gauntlet/preview` computes an unsaved plan (rendered from
`planToPreviewPods()`'s output, structurally the same shape as a persisted one), again once
`POST /api/seasons/[id]/gauntlet` actually commits it (that route's response includes the
freshly-built `pods`), and in a season's "Gauntlet" tab (`SeasonTabView`) once the paired gauntlet has
one — the tab itself is hidden (`src/app/seasons/[id]/page.tsx`) until `gauntletBracketShape` or
`gauntletRounds` has something in it, so a bare gauntlet-season shell with neither shows no tab at
all rather than an empty one. An unresolved slot never reads a bare "TBD" — a seed-sourced slot names
the seed ("Seed 3"), and a pod-sourced slot names the source pod and, for a pod that sends more than
one survivor onward, which of them ("Winner of Round 1 Group 1", "Second of Round 1 Group 2"). The
existing round-by-round `GauntletRoundsList` below the diagram still carries per-game detail (scores,
maps, stats). `getGauntletBracketShape()` returns `[]` for a manual gauntlet (no `gauntlet_pods`
rows), so the diagram silently no-ops there and the page falls back to the plain round list.

`DELETE /api/seasons/[id]/gauntlet` reverses either step — it refuses once any of the gauntlet's
matches has a played score, otherwise deletes the gauntlet season and everything materialized under
it (`deleteGauntletSeason()` in `gauntlet-engine.ts`, also reused to clean up a failed build),
freeing the regular season to have its bracket rebuilt from scratch. It deletes `gauntlet_pod_slots`
before `gauntlet_pods` — `gauntlet_pod_slots` has two FKs into `gauntlet_pods` (`pod_id` and
`source_pod_id`, neither `ON DELETE CASCADE`), so deleting pods first trips the `source_pod_id` FK on
any slot still pointing at one as its advancement source. Pass `{ force: true }` to
delete anyway even if matches have been played — there is no undo, so the admin UI (below) requires
typing the gauntlet's name to confirm. If the gauntlet had already archived its paired regular
season (see "Season status lifecycle"), deleting it reverts that season back to `COMPLETED` — an
archived season with no gauntlet behind it is a dead end. The admin console's Manage → Season view
(`SeasonManager.tsx`) surfaces build, seed, and reset together, one row per season, based on where it
is in that lifecycle.

#### Manual bracket construction

Manual bracket building (`/admin/seasons/gauntlet/manual/[id]`, `GauntletPodEditor.tsx`) shares the
exact same `gauntlet_pods`/`gauntlet_pod_slots` model the generator produces — a hand-built pod and
a generated one are indistinguishable to `resolveAndPropagate()`, `materializeIfReady()`,
`getGauntletRounds()`, or `canonicalGauntletRankMap()`. Two conventions make this work without any
schema addition:

- A **seed-driven slot** is `source_kind: 'seed'`. The admin picks a *seed number*, not a specific
  player — the same numeric-seed indirection the generator uses, not a shortcut around it. The seed
  number is `source_seed`; `player_id` is resolved from it against the regular season's *current*
  standings every time the draft is saved (`saveManualDraft()`), the same mapping `seedBracket()`
  uses at real seed time. This is what lets an unmaterialized slot always track whoever the standings
  currently say holds that seed — a mid-season standings shuffle doesn't quietly strand a stale pick
  the admin has to notice and fix by hand, and it's what makes `materializePod()`'s seed-based
  SHIRTS/SKINS pairing work identically whether a pod's occupants arrived via the generator or the
  editor. An **advancement-sourced slot** is `source_kind: 'pod'` with `source_pod_id` set and
  `player_id: null`, identical to a generated pod's "winner of an earlier pod" slot —
  `resolveAndPropagate()` fills it in with zero pod-editor-specific code once that source pod's 2
  games finish, so a hand-built pod referencing "Round 1 Group 1's winner" resolves automatically
  just like a generated one would.
- Once a pod **materializes** (its real matches exist), its occupants are frozen — a real match
  already has real, fixed participants, so they must never be re-resolved against standings that
  keep moving after the fact. The editor captures this at load time into each `DraftPod`'s
  `materializedOccupants` (`gauntlet-draft.ts`), read from the persisted `BracketSlot.player_name`
  rather than derived live, and locks the pod from further editing entirely (see below).
- `getSeedBands()` (used by `trySeedGauntlet()`) filters its `source_kind: 'seed'` query to
  `source_seed IS NOT NULL AND player_id IS NULL` — every seed slot (generator or manual) carries a
  `source_seed`, so the `player_id IS NULL` half of the filter is what actually isolates a
  generator-built shape's *unseeded* slots (awaiting `seedBracket()`) from everything else, manual or
  already-seeded.
- `materializeIfReady()` never turns a fully-seeded pod into real matches while the paired regular
  season is still ACTIVE or UPCOMING (`regularSeasonIsDone()`) — a manually-built gauntlet can be
  seeded and structured well before the regular season it draws standings from is actually over, and
  nothing should go live while the standings behind those seed numbers could still move. The pod
  stays saved (fully seeded, visibly so in the editor) but not materialized; a later save — there's
  no automatic retry, since `checkSeasonCompletion()`'s own trigger only ever drives the generator's
  path — turns it into real matches once the season completes. `saveManualDraft()` surfaces this as a
  warning rather than silence, so the admin isn't left wondering why nothing happened.

The editor is a **batch draft** with an edit/preview split, mirroring the generator's own
preview/confirm/cancel flow: the "editing" stage (`GauntletPodEditor.tsx`) is plain tables — a
roster panel to mark players sitting out, and one card per pod with its elimination-scale toggle,
Final checkbox, and 4 slot pickers — no diagram. Every slot picker offers seed numbers ("Seed 3 —
PlayerName"), not players, labeled against the season's current canonical-sort standings (a player's
seed is their 1-based position in that order) — the roster panel (marking someone as sitting out)
is the one place still keyed by player, since "who's out" is inherently about a person, not a seed
position. Clicking "Review Bracket" only switches to a "preview" stage — the same
`GauntletBracketDiagram` the season page uses, plus the completeness status banner — behind
Confirm/Back, exactly like the generator's own preview stage; nothing is written until Confirm calls
`POST /api/seasons/[id]/gauntlet/pods` (`saveManualDraft()` in `gauntlet-engine.ts`). That route
diffs the submitted draft against whatever's currently persisted: new pods are inserted,
changed-but-not-yet-materialized pods are updated, and not-yet-materialized pods missing from the
submission are deleted — a pod with real matches (`materialized: true` in `BracketPod`) is always
left alone and can't be edited or deleted from this UI, and every seed slot's `player_id` is
re-resolved against fresh standings regardless of whatever the submitted draft happened to carry, so
a stale client payload can't freeze in an out-of-date pick. `gauntlet-draft.ts`'s
`pruneInvalidReferences()` runs after every local edit or deletion, so by the time a draft is
submitted it's already internally self-consistent (no slot references a pod that no longer exists,
or an advancement beyond its source's capacity) — the save route only re-validates this defensively
(`validateIntegrity()`), it doesn't repeat the cascade-clearing logic. The whole pod/slot diff is
applied atomically via the `reconcile_gauntlet_draft()` DB function (one Postgres transaction), and
`saveManualDraft()` re-checks materialization for the specific pods it's about to touch immediately
before writing, protecting any that a live match resolved into concurrently instead of overwriting
them — with a warning surfaced back to the editor for whatever got skipped.

Loading the editor's initial draft: an already-persisted shape always wins
(`fromPersistedShape()`); otherwise it defaults to the same plan the generator's own preview stage
would compute (`fromGeneratedPlan(buildGauntletBracket(N))` — identical by construction, so the
"build by hand instead" link on that preview needs no data transfer, just a plain link to this page);
or, for a qualifier count outside `buildGauntletBracket`'s range, a single empty round with one empty
pod.

Dropped players (sitting out this gauntlet entirely) are never persisted — same as the generator's
own `BracketPlan.drops`, which `persistBracketShape()` also never writes anywhere. The editor just
tracks a `droppedPlayerIds` set as ephemeral UI state, and a dropped player's seed is excluded from
`availableSeeds()` so the slot pickers stop offering it.

### Season status lifecycle

`seasons.status` (`UPCOMING`/`ACTIVE`/`COMPLETED`/`ARCHIVED`) applies to both regular and gauntlet
season rows and has one admin-triggered and two automatic transitions, all in
`src/lib/season-lifecycle.ts`:

- **`UPCOMING` → `ACTIVE`** ("go live", regular seasons only) is an explicit admin action —
  `PATCH /api/seasons/[id]/status` (`{ status: 'ACTIVE' }`), surfaced as the "Mark Active" button
  next to the start-date control on a season's page (`MarkSeasonActiveButton.tsx`). `activateSeason()`
  flips the status, then best-effort calls `tryBuildGauntletShape()` — a build failure never blocks
  the season going live.
- **`ACTIVE` → `COMPLETED`** (regular seasons) is fully automatic — `checkSeasonCompletion()` runs
  from a non-fatal hook on `PATCH /api/matches/[id]/score` for every non-gauntlet match. If the
  score just committed means every match in that season (via `weeks.season_id`) now has a played
  score, the season flips to `COMPLETED` and `trySeedGauntlet()` runs best-effort against final
  standings. A season with no matches yet, or with any match still unplayed, is never "fully
  played" — nothing fires until the literal last match is scored.
- **`→ ARCHIVED`** (gauntlet seasons, cascading to their paired regular season) is also fully
  automatic — `checkGauntletCompletion()` runs from a non-fatal hook on every gauntlet match score,
  sharing the same `isSeasonFullyPlayed()` check `checkSeasonCompletion()` uses (every match under
  the season, not just the highest `round_number`'s). Once true, it archives the gauntlet season
  and, via `getLinkedRegularSeason()`, its paired regular season too — regardless of the regular
  season's current status. A season isn't fully "in the books" until its playoffs conclude, so
  `ARCHIVED` is reached through the gauntlet, not the regular season's own match completion.
  Checking every match rather than only the final round matters for manually-built gauntlets (see
  below) — an automated bracket's final round can't materialize until every earlier pod has
  resolved, so the two checks coincide there, but nothing enforces that ordering for a hand-built
  one.

Gauntlet seasons are born `ACTIVE` at creation and have no `UPCOMING` phase or admin-triggered
transition of their own — `ACTIVE → ARCHIVED` is their entire lifecycle, driven by
`checkGauntletCompletion()` alone.

**`@Participants` Discord role sync (#397).** `activateSeason()` best-effort grants the role to
every linked (`discord_id` set) player on the roster — a catch-up pass covering anyone who linked
Discord after already being added, since `POST /api/seasons/[id]/players`'s own per-player grant
(see below) would have been a no-op at that time. `checkSeasonCompletion()` best-effort revokes it
from the same roster once the season is `COMPLETED` — the role tracks the *current* season's
participants, not a career badge. `syncParticipantRoleForPlayer()` covers the other trigger — a
player linking Discord after already being rostered — by granting the role right away if they're on
the active roster; it's called from the OAuth callback and the admin override's link path. The role
is always driven by roster membership: unlinking Discord never revokes it, since a player can be
rostered and participating without ever linking their account. Everything here goes through
`src/lib/discord-roles.ts`, which no-ops unconditionally (no error, no throw) when
`DISCORD_BOT_TOKEN`/`DISCORD_GUILD_ID`/`DISCORD_PARTICIPANTS_ROLE_ID` aren't all set, or when a given
player has no linked `discord_id` — a real Discord API failure is recorded to `ops_errors`
(`discord_role_sync`), see below.

#### Surfacing best-effort failures (`ops_errors`)

Any best-effort operation that fails (or produces an outcome needing admin attention, like a roster
drift) records it in the generic `ops_errors` table via `recordOpsError()` / `clearOpsError()`
(`src/lib/ops-errors.ts`), rather than only `console.error`-ing — application logs aren't visible to
an admin deciding what to do next. Rows are keyed by `(entity_type, entity_id, operation)`, not just
`entity_id`, since more than one operation can attach to the same entity (a match's steam-id
learning and its server teardown, for instance) — without `operation` in the key, one operation's
success would clear an unrelated operation's still-live failure. `entity_id` is `0` for the one
operation with no single entity (the site-wide EHOG recompute), using `entity_type = 'system'`.

Rows are never hard-deleted. `dismissed_at` marks a row no-longer-live — set when an admin dismisses
it (`DELETE /api/ops-errors/[id]`) or when a later attempt at the same `(entity_type, entity_id,
operation)` succeeds (`clearOpsError()`) — and is cleared automatically the next time that key fails
again. `getOpsErrors()` (the live Activity-feed/`OpsErrorList` view) filters to `dismissed_at IS
NULL`; `getOpsErrorHistory()` reads every row from the last 8 weeks regardless of `dismissed_at`,
grouped into a flat `(operation, week)` failure count, for the admin console's Activity → History
tab.

Wired into twenty-one operations today:

| Operation | Entity | Recorded from |
|---|---|---|
| `gauntlet_build` | `season` (regular) | `activateSeason()` |
| `season_complete` | `season` (regular) | `checkSeasonCompletion()`, if the `COMPLETED` status update itself fails |
| `gauntlet_seed` | `season` (regular) | `checkSeasonCompletion()` (including a `trySeedGauntlet()` roster-`drift` result, which needs the same admin attention as a thrown error even though it isn't one) |
| `gauntlet_archive` | `season` (gauntlet) | `checkGauntletCompletion()` |
| `gauntlet_delete` | `season` (gauntlet) | `deleteGauntletSeason()`'s mid-sequence failure — safe to retry since every delete step is a no-op against an already-empty target |
| `gauntlet_manual_save` | `season` (regular) | `saveManualDraft()` (`gauntlet-engine.ts`)'s materialize-step failure, and `POST /api/seasons/[id]/gauntlet/pods`'s own catch for any earlier failure in the same call |
| `steam_id_learn` | `match` | `applyEliminationSteamIds()`'s hook in the score route |
| `server_provision` | `match` | `provisionErrorHandler()` (`dathost-lifecycle.ts`)'s hook for a deferred `provisionMatchServer()` call, bound in `POST /api/matches/[id]/server/provision` and the veto route's auto-provision |
| `server_teardown` | `match` | `teardownMatchServer()`'s hooks in the score route, `/api/ingest/matchzy-log`, and `POST /api/matches/[id]/server/teardown` |
| `sabremetrics_persist` | `match` | `persistSabremetrics()`/`clearSabremetrics()`'s hook in the score route |
| `weapon_stats_persist` | `match` | `persistWeaponStats()`/`clearWeaponStats()`'s hook in the score route |
| `live_score_clear` | `match` | `clearLiveScoreBestEffort()` (`liveScore.ts`), called by `pullDemoAndClearLiveScore()` and by `writeMatchScore()`'s fallback |
| `name_history_log` | `player` | `recordNameChange()` (`src/lib/player-name-history.ts`), from both `PATCH /api/players/[id]` and `PATCH /api/players/me/name` — also recorded directly if the admin route can't even read the player's prior name to log a "from" |
| `ehog_recompute` | `system` (id `0`) | `triggerRatingRecompute()` |
| `schedule_generate` | `season` (regular) | `generateSeasonScheduleDraft()`'s (`season-schedule-draft-engine.ts`) mid-loop failure, before the compensating cleanup runs |
| `schedule_generate_cleanup` | `season` (regular) | `generateSeasonScheduleDraft()`'s compensating cleanup, if that cleanup itself fails |
| `schedule_confirm` | `season` (regular) | `confirmSeasonScheduleDraft()`'s (`season-schedule-draft-engine.ts`) mid-loop failure, before the compensating cleanup runs |
| `schedule_confirm_cleanup` | `season` (regular) | `confirmSeasonScheduleDraft()`'s compensating cleanup, if that cleanup itself fails |
| `discord_notify_server_live` | `match` | `notifyMatchServerLive()` (`discord-notify.ts`, #395) — a real webhook failure, not just the channel being unconfigured |
| `discord_notify_score` | `match` | `notifyMatchScoreReported()` (`discord-notify.ts`, #395) — a real webhook failure, not just the channel being unconfigured. A distinct operation from `discord_notify_server_live` (not a shared `discord_notify`) so a failure from one notification can't be silently cleared by an unrelated success of the other for the same match |
| `discord_role_sync` | `player`, or `season` (regular) for a roster-fetch failure | `discord-roles.ts` (#397)'s `setGuildMemberRole()` for the per-player case — a real Discord API failure, not just the role sync being unconfigured or the player having no `discord_id`; `season-lifecycle.ts`'s `syncParticipantRoleForRoster()` for the season-level case, when fetching the roster itself fails ahead of the (never-throwing) per-player grant/revoke pass |
| `discord_link` | `player`, or `system` (id `0`) for a config failure | `GET /api/auth/discord/callback` (#394) — a genuine failure (bad response from Discord, an unhandled exception, missing `DISCORD_CLIENT_ID`/`SECRET`), not the expected "denied"/"taken" outcomes, which redirect the one affected player but aren't logged |

Each is cleared automatically the next time that same (entity, operation) succeeds —
`tryBuildGauntletShape()` and `trySeedGauntlet()` clear their own on success, `checkGauntletCompletion()`
clears `gauntlet_archive` once both halves of the archive (the gauntlet season and its paired regular
season) are confirmed archived — tracking each half's outstanding status independently so a run that
archived one but failed on the other retries only the missing half next time — `deleteGauntletSeason()`
clears `gauntlet_build`/`gauntlet_seed` on the regular season, `gauntlet_archive` on the gauntlet
season itself, and its own `gauntlet_delete` on a later successful reset, and the remaining hooks
clear theirs inline once their surrounding
try block completes without error — including `generateSeasonScheduleDraft()`/`confirmSeasonScheduleDraft()`,
which clear both their own operation and its paired `_cleanup` operation (in case an earlier attempt's
compensating cleanup also failed) on a later success.

`getOpsErrors()` in `src/lib/queries/ops.ts` reads every live row, resolving `entity_id` to a display name
(season/match name, or "EHOG Recompute" for `system`). The admin console's Activity → Errored tab
(`AdminActivityFeed.tsx`) lists all of them, merged with failed background jobs; Manage → Season
(`SeasonManager.tsx`) shows the same rows filtered to `entity_type = 'season'` in an "Attention Needed"
section above the rest of the view (`OpsErrorList.tsx`, shared by both). Either surface's Dismiss
button clears a row via `DELETE /api/ops-errors/[id]` without waiting for the underlying operation to
succeed on its own.

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

### CI

`.github/workflows/ci.yml` gates PRs and pushes to `main`: a `frontend` job (`npm run typecheck && npm run lint && npm test && npm run build`), an `ingestion` job (`python3 -m unittest tests.test_ingest`), and an `ehog` job (the Python↔TS parity test — see [`ehog.md`](./ehog.md)'s "Running" section), each skipped unless its area's paths changed. The frontend job needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` as repo secrets — `next build` prerenders static pages that read from Supabase. This is separate from `demo-ingest.yml`/`radar-build.yml`, which are `workflow_dispatch`/`repository_dispatch`-triggered ingestion jobs, not PR gates.
