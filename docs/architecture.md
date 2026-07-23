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
| `/admin` | Admin hub — links to admin tools (linked from the Topbar when `session.user.isAdmin`) |
| `/admin/jobs` | Admin background-jobs dashboard — every `background_jobs` row across all three pipelines (`demo_ingest`, `replay_extract`, `radar_build`) with warnings/quarantine flags and per-type actions: confirm/re-parse/dismiss for demo, retry for replay/radar (see [`hosting.md`](./hosting.md)) |
| `/admin/servers` | Admin server console — shared DatHost server status + teardown (see [`hosting.md`](./hosting.md)) |
| `/admin/matches` | Admin match console — search a match to reschedule, clear/redo its pick-ban, or toggle the feature flag (reuses the match-page editors; score/stats editing stays on the match page) |
| `/admin/players` | Admin player console — search a player to rename, toggle `is_admin`, or manage their Steam link (unlink / set SteamID64 by hand); also a manual EHOG rating recompute |
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
| `PATCH` | `/api/seasons/[id]/status` | Transition a regular season `UPCOMING` → `ACTIVE` ("go live"); best-effort builds its gauntlet shape (admin only) |
| `DELETE` | `/api/ops-errors/[id]` | Dismiss an `ops_errors` row, any entity type (admin only) |
| `POST` | `/api/seasons/[id]/gauntlet/preview` | Compute what building would produce — qualifier count, games, rounds, pod/slot shape — without writing anything (admin only) |
| `POST` | `/api/seasons/[id]/gauntlet` | Create the paired gauntlet season for an active regular season and build its bracket *shape* — unseeded, nothing materialized (admin only) |
| `POST` | `/api/seasons/[id]/gauntlet/seed` | Seed an existing shape from the season's current leaderboard order and materialize round 1 (admin only) |
| `DELETE` | `/api/seasons/[id]/gauntlet` | Reset a gauntlet — deletes it and everything materialized under it; refuses if any match has a score unless `{ force: true }` is passed (admin only) |
| `POST` | `/api/seasons/[id]/gauntlet/pods` | Save the manual pod editor's current draft — creates the paired gauntlet season if needed, then inserts/updates/deletes pods to match (admin only) |
| `PATCH` | `/api/players/[id]` | Edit a player — display name, `is_admin` (can't demote yourself), or Steam link (unlink / set SteamID64) (admin only) |
| `PATCH` | `/api/players/me/name` | Self-service rename — the caller's own display name only, letters/spaces only, once every 7 days |
| `POST` | `/api/ehog/recompute/trigger` | Admin-gated "recompute EHOG ratings now" — fires the full rating walk in the background (admin only) |
| `GET/POST` | `/api/players/register` | List unlinked players / link a Steam account to a player record |
| `GET` | `/api/cron/refresh-steam` | Refresh Steam avatars/nicknames for all linked players (Vercel cron; see below) |

## Database

Supabase (`public` schema). RLS is **off** on all tables — do not enable it without writing policies first. Types mirroring these shapes live in `src/lib/types.ts`.

**Any Supabase MCP tool that mutates state** — `apply_migration`, a non-`SELECT` `execute_sql`, or any project/branch-management tool (`create_project`, `create_branch`, `delete_branch`, `merge_branch`, `rebase_branch`, `reset_branch`, `restore_project`, `pause_project`, `deploy_edge_function`, `confirm_cost`) — **requires the user's explicit approval of that exact command, given at the time it's about to run.** See [`../AGENTS.md`](../AGENTS.md)'s "Supabase changes require live, per-operation approval." Read-only tools (`list_tables`, `get_logs`, `get_advisors`, `search_docs`, `list_migrations`, `list_branches`, `list_extensions`, `list_projects`, `get_project`, `get_organization`, `list_organizations`, `get_cost`, `get_project_url`, `get_publishable_keys`, `list_edge_functions`, `get_edge_function`, `generate_typescript_types`, and a plain-`SELECT` `execute_sql`) don't need it.

### Tables

| Table | Purpose |
|---|---|
| `seasons` | One row per season. Key fields: `name`, `status` (`UPCOMING`/`ACTIVE`/`COMPLETED`/`ARCHIVED`), `is_gauntlet` (bool), `start_date`, `map_pool` (text[]), `target_win_rounds`, `buy_in_amount` |
| `weeks` | Linked to `seasons`. Has `week_number` and `bye_player_id` (who sits out that week) |
| `matches` | Linked to `weeks`. Veto fields: `shirts_ban`, `shirts_ban2`, `skins_ban1`, `skins_ban2`, `shirts_pick`, `picked_map`, `skins_starting_side`. Also: `final_score`, `is_playoff_game`, `scheduled_at`, `screenshot_url_front/back`, `notes`. `pre_match_win_prob` (nullable) — frozen SHIRTS-win probability from the EHOG recompute, paired with `pre_match_win_prob_formula_version`; see [`ehog.md`](./ehog.md). Hosting (see [`hosting.md`](./hosting.md)): `server_state`, `dathost_server_id`, `connect_string`, `server_started_at` |
| `players` | Global player registry. Unique `name`. Steam fields: `steam_id`, `steam_nickname`, `steam_avatar_url`, `steam_refreshed_at`. Admin flag: `is_admin`. `seed_ehog` (nullable) — admin-configured starting EHOG rating for a known new player; see [`ehog.md`](./ehog.md) |
| `player_name_history` | One row per rename: `player_id`, `old_name`, `new_name`, `changed_at`. Written by both `PATCH /api/players/[id]` (admin) and `PATCH /api/players/me/name` (self-service); read via `getPlayerNameHistory()` for the once-a-week self-service cooldown and the "Formerly …" line on a player's public profile |
| `player_match_stats` | Per-player per-match basics: `faction` (`SHIRTS`/`SKINS`), K/A/D, `damage`, `adr`, `rounds_played`, `rounds_won`, `is_win` |
| `player_match_sabremetrics` | Demo-derived advanced stats, one row per `player_match_stats` row (FK `player_match_stats_id`): CT/T side splits, opening duels, KAST, clutches, utility, objectives. Written only when a demo is parsed. See [`demo-ingestion.md`](./demo-ingestion.md). |
| `player_rating_history` / `player_current_ratings` | EHOG skill-rating storage (μ/σ history + current standings). Written by the EHOG recompute. See [`ehog.md`](./ehog.md). |
| `background_jobs` | Background-job state machine, one row per (`job_type`, `match_id`). `job_type` is `replay_extract` ([`replay.md`](./replay.md)) or `demo_ingest` ([`hosting.md`](./hosting.md)); tracks `status`/`stage`/`error_message` + GitHub Action run refs. |
| `gauntlet_pods` | One row per pod in a gauntlet bracket: `season_id`, `round_number` (== `weeks.week_number`), `pod_index`, `advance_rule` (`single`/`wildcard`), `is_final`, `week_id`, `match1_id`/`match2_id` (set once materialized). Frozen at bracket creation — nothing re-derives it. |
| `gauntlet_pod_slots` | The 4 slots (`slot_index` 0-3) feeding each pod: `source_kind` (`seed`/`pod`), `source_seed` (for seed slots) or `source_pod_id` (the advancement edge, for pod slots), and the resolved `player_id`. |
| `ops_errors` | Generic best-effort-operation-failure surface: `entity_type` (`season`/`match`/`system`), `entity_id` (`0` for the `system` singleton), `operation`, `message`, `occurred_at`. Unique on `(entity_type, entity_id, operation)`. See "Surfacing best-effort failures". |
| `scrim_sessions` | Singleton table (`id` pinned to `1`) tracking the one active scrim, if any: `started_by` (owner, for the stop-authorization check), `warned_15`/`warned_10`/`warned_5` (pre-match warning one-shots). See [`hosting.md`](./hosting.md)'s Scrims section. |

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
archived season with no gauntlet behind it is a dead end. `/admin/seasons/gauntlet` surfaces build,
seed, and reset together, one row per season, based on where it is in that lifecycle.

#### Manual bracket construction

Manual bracket building (`/admin/seasons/gauntlet/manual/[id]`, `GauntletPodEditor.tsx`) shares the
exact same `gauntlet_pods`/`gauntlet_pod_slots` model the generator produces — a hand-built pod and
a generated one are indistinguishable to `resolveAndPropagate()`, `materializeIfReady()`,
`getGauntletRounds()`, or `canonicalGauntletRankMap()`. Two conventions make this work without any
schema addition:

- A **directly-placed slot** is `source_kind: 'seed'` with `source_seed: null` and `player_id`
  already set — skipping the generator's separate numeric-seed indirection entirely, since the admin
  already knows the real player. An **advancement-sourced slot** is `source_kind: 'pod'` with
  `source_pod_id` set and `player_id: null`, identical to a generated pod's "winner of an earlier
  pod" slot — `resolveAndPropagate()` fills it in with zero pod-editor-specific code once that
  source pod's 2 games finish, so a hand-built pod referencing "Round 1 Group 1's winner" resolves
  automatically just like a generated one would.
- `getSeedBands()` (used by `trySeedGauntlet()`) filters its `source_kind: 'seed'` query to
  `source_seed IS NOT NULL` — otherwise a manual gauntlet's directly-placed slots (also
  `source_kind: 'seed'`, but with no seed number) would corrupt the round1/byes/dropped accounting
  that only makes sense for a generator-built shape.

The editor is a **batch draft** with an edit/preview split, mirroring the generator's own
preview/confirm/cancel flow: the "editing" stage (`GauntletPodEditor.tsx`) is plain tables — a
roster panel to mark players sitting out, and one card per pod with its elimination-scale toggle,
Final checkbox, and 4 slot pickers — no diagram. Every player reference here is labeled by seed
number ("Seed 3 — PlayerName"), since `players` is passed in canonical-sort order and a player's seed
is just their 1-based position in that array; this keeps hand-building anchored to the same seed
numbers the generator would have used. Clicking "Review Bracket" only switches to a "preview" stage —
the same `GauntletBracketDiagram` the season page uses, plus the completeness status banner — behind
Confirm/Back, exactly like the generator's own preview stage; nothing is written until Confirm calls
`POST /api/seasons/[id]/gauntlet/pods` (`saveManualDraft()` in `gauntlet-engine.ts`). That route
diffs the submitted draft against whatever's currently persisted: new pods are inserted,
changed-but-not-yet-materialized pods are updated, and not-yet-materialized pods missing from the
submission are deleted — a pod with real matches (`materialized: true` in `BracketPod`) is always
left alone and can't be edited or deleted from this UI. `gauntlet-draft.ts`'s
`pruneInvalidReferences()` runs after every local edit or deletion, so by the time a draft is
submitted it's already internally self-consistent (no slot references a pod that no longer exists,
or an advancement beyond its source's capacity) — the save route only re-validates this defensively
(`validateIntegrity()`), it doesn't repeat the cascade-clearing logic.

Loading the editor's initial draft: an already-persisted shape always wins
(`fromPersistedShape()`); otherwise it defaults to the same plan the generator's own preview stage
would compute (`fromGeneratedPlan(buildGauntletBracket(N), leaderboard)` — identical by
construction, so the "build by hand instead" link on that preview needs no data transfer, just a
plain link to this page); or, for a qualifier count outside `buildGauntletBracket`'s range, a single
empty round with one empty pod.

Dropped players (sitting out this gauntlet entirely) are never persisted — same as the generator's
own `BracketPlan.drops`, which `persistBracketShape()` also never writes anywhere. The editor just
tracks a `droppedPlayerIds` set as ephemeral UI state so the slot pickers stop offering them.

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

#### Surfacing best-effort failures (`ops_errors`)

Any best-effort operation that fails (or produces an outcome needing admin attention, like a roster
drift) records it in the generic `ops_errors` table via `recordOpsError()` / `clearOpsError()`
(`src/lib/ops-errors.ts`), rather than only `console.error`-ing — application logs aren't visible to
an admin deciding what to do next. Rows are keyed by `(entity_type, entity_id, operation)`, not just
`entity_id`, since more than one operation can attach to the same entity (a match's steam-id
learning and its server teardown, for instance) — without `operation` in the key, one operation's
success would clear an unrelated operation's still-live failure. `entity_id` is `0` for the one
operation with no single entity (the site-wide EHOG recompute), using `entity_type = 'system'`.

Wired into nine operations today:

| Operation | Entity | Recorded from |
|---|---|---|
| `gauntlet_build` | `season` (regular) | `activateSeason()` |
| `season_complete` | `season` (regular) | `checkSeasonCompletion()`, if the `COMPLETED` status update itself fails |
| `gauntlet_seed` | `season` (regular) | `checkSeasonCompletion()` (including a `trySeedGauntlet()` roster-`drift` result, which needs the same admin attention as a thrown error even though it isn't one) |
| `gauntlet_archive` | `season` (gauntlet) | `checkGauntletCompletion()` |
| `steam_id_learn` | `match` | `applyEliminationSteamIds()`'s hook in the score route |
| `server_teardown` | `match` | `teardownMatchServer()`'s hooks in the score route and `/api/ingest/notify` |
| `sabremetrics_persist` | `match` | `persistSabremetrics()`/`clearSabremetrics()`'s hook in the score route |
| `name_history_log` | `player` | `recordNameChange()` (`src/lib/player-name-history.ts`), from both `PATCH /api/players/[id]` and `PATCH /api/players/me/name` — also recorded directly if the admin route can't even read the player's prior name to log a "from" |
| `ehog_recompute` | `system` (id `0`) | `triggerRatingRecompute()` |

Each is cleared automatically the next time that same (entity, operation) succeeds —
`tryBuildGauntletShape()` and `trySeedGauntlet()` clear their own on success, `checkGauntletCompletion()`
clears `gauntlet_archive` once both halves of the archive (the gauntlet season and its paired regular
season) are confirmed archived — tracking each half's outstanding status independently so a run that
archived one but failed on the other retries only the missing half next time — `deleteGauntletSeason()`
clears `gauntlet_build`/`gauntlet_seed` on the regular season and `gauntlet_archive` on the gauntlet
season itself as part of a reset, and the remaining hooks clear theirs inline once their surrounding
try block completes without error.

`getOpsErrors()` in `src/lib/queries/ops.ts` reads every live row, resolving `entity_id` to a display name
(season/match name, or "EHOG Recompute" for `system`). `/admin/ops-errors` lists all of them;
`/admin/seasons/gauntlet` ("Manage Gauntlet") shows the same list filtered to `entity_type = 'season'`
in an "Attention Needed" section above the rest of the page (`OpsErrorList.tsx`, shared by both).
Either page's Dismiss button clears a row via `DELETE /api/ops-errors/[id]` without waiting for the
underlying operation to succeed on its own.

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

`.github/workflows/ci.yml` gates PRs and pushes to `main`: a `frontend` job (`npm run lint && npm test && npm run build`) and an `ingestion` job (`python3 -m unittest tests.test_ingest`), each skipped unless its area's paths changed. The frontend job needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` as repo secrets — `next build` prerenders static pages that read from Supabase. This is separate from `demo-ingest.yml`/`radar-build.yml`, which are `workflow_dispatch`/`repository_dispatch`-triggered ingestion jobs, not PR gates.
