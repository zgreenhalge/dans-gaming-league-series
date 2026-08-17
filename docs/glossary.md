# Glossary & Codebase Map

A vocabulary and orientation reference for DGLS — for new contributors and AI agents alike.
The README documents *what* the system does; this doc explains the *terms* and *where things live*
so you don't have to reverse-engineer them from scratch each time.

## League format & domain terms

- **Individual Rotating Mixer** — the league format. Teammates change every week (randomly drawn),
  so match outcomes are partly a function of your draw, not just your skill. RWR% and ADR are
  rate-normalized stats that help correct for that when breaking ties in the canonical leaderboard
  sort.
- **ADR (Average Damage per Round)** — the platform's primary individual skill metric; the
  *tertiary* tiebreaker in the canonical leaderboard sort (Wins → RWR% → ADR). Never sort by ADR
  alone — always apply `canonicalSort()` from `src/lib/util.ts`.
- **Wins (match wins)** — `matches_won`; the *primary* sort key in the canonical leaderboard sort —
  a raw win count, not rate-normalized.
- **WR% (Win Rate)** — `wins / games_played`; displayed alongside the win/loss record but not
  itself a key in the canonical leaderboard sort. Stored as `total_wins / total_games` on
  `player_season_leaderboard`.
- **RWR% (Round Win Rate)** — `total_rounds_won / total_rounds_played`; the *secondary* sort key in
  the canonical leaderboard sort. Derived, not stored; see `LeaderboardRow.rwr_percentage` in
  `src/lib/types.ts`.
- **Canonical sort (regular season)** — the standard leaderboard sort order for regular-season and
  career views: **Wins → RWR% → ADR**, all descending. Implemented by `canonicalSort()` in
  `src/lib/util.ts`; see
  [`calculations.md`](./calculations.md#canonical-regular-season-ranking)
  for the full rationale. Not to be confused with the canonical *gauntlet* ranking below.
- **EHOG (rating)** — the DGLS player skill rating, an [OpenSkill](https://github.com/philihp/openskill.js)
  PlackettLuce model mapped onto a 10–100 display scale via a logistic transform. Match-outcome-based
  (win/loss + margin of victory), not individual-stat-based. Updated via full chronological recompute
  after every score submission. See [`ehog.md`](./ehog.md) for the full engine docs.
  Not to be confused with the aspirational *Player Rating* sabremetric composite in
  [`calculations.md`](./calculations.md#player-rating-aspirational--requires-demo-data).
- **Seed EHOG** — an admin-configured starting EHOG rating (`players.seed_ehog`) for a known new
  player, used in place of the global new-player default until their first rated match. Set from the
  admin console's Manage → Player view; see [`ehog.md`](./ehog.md#seeding-a-known-players-starting-rating).
- **EHOG win probability** — the pre-match probability one team beats another, derived purely from
  the teams' current OpenSkill state via the library's own `predict_win`/`predictWin` — no trained
  model, outcome-only like the rest of EHOG. See [`ehog.md`](./ehog.md#pre-match-win-probability).
- **Faction: SHIRTS / SKINS** — the two ad-hoc teams for a given match (CS2 Wingman is 2v2).
  Rosters are reshuffled weekly, hence "rotating mixer."
- **Veto** — the map pick/ban sequence before a match (`shirts_ban`, `shirts_ban2`, `skins_ban1`,
  `skins_ban2`, `shirts_pick`, `picked_map`, `skins_starting_side` on `Match`). Rendered by
  `VetoSequence.tsx`. Gauntlet seasons use a *different* veto flow — see below.
  - **Effective played map** is `shirts_pick ?? picked_map`, not `picked_map` alone. When shirts
    made the pick, `shirts_pick` is set and `picked_map` is `null`; when skins made the pick,
    `shirts_pick` is `null` and `picked_map` is set. Always resolve with `shirts_pick ?? picked_map`.
  - **Who picked** is determined by `shirts_pick != null` (shirts picked) vs `shirts_pick == null`
    (skins picked). Do **not** compare `shirts_pick === picked_map` — they are never equal because
    only one is populated per match.
  - **Gauntlet matches lack pick/ban data** entirely (`GauntletMatch` has no veto fields). Veto
    aggregations must be guarded with `is_gauntlet` checks or by only operating on the structures
    that carry veto fields (`Match`, `MatchWithRoster`, `MapMatchRow`).
- **Gauntlet** — a season format (`is_gauntlet = true`) that runs as a single-elimination bracket
  instead of round-robin weeks. **Gauntlet = playoffs**: there is no separate non-gauntlet "playoff"
  format anywhere in the app, and `is_gauntlet` (season) is the flag code should prefer for picking a
  veto shape or ranking rule. This pairing is a convention, not a DB constraint: the gauntlet CSV
  importer (`ingestion/import_gauntlets.py`) writes `is_playoff_game = true` on the matches and then
  patches the season's `is_gauntlet` in a separate step that can silently no-op (warns and returns if
  the season name lookup fails), so a botched import can leave a season with real playoff matches but
  `is_gauntlet = false`. For that reason, the display paths that read a match's veto
  shape — `isVetoComplete()` (`src/lib/veto.ts`) and `VetoSequence.tsx`'s step/tile selection — treat
  `isGauntlet || match.is_playoff_game` as gauntlet-shaped rather than trusting `is_gauntlet` alone;
  live veto submission (`/api/matches/[id]/veto`) still keys off `is_gauntlet` alone since only
  already-played CSV imports can hit the mismatch.
  - `weeks` rows represent **bracket rounds**, not calendar weeks
  - Veto is simultaneous (each side submits 2 bans at once, no turn order); 4 bans total auto-picks
    the remaining map
  - **All gauntlet matches are stored with `is_playoff_game = true`**, so the regular
    `player_season_leaderboard` view excludes them entirely — gauntlet stats must be computed
    directly from `player_match_stats` (`getGauntletStats`, `getGauntletSeasonLeaderboard`,
    `getGauntletRounds`)
  - **Canonical gauntlet ranking** — the official finish order for a completed gauntlet; see
    [`calculations.md`](./calculations.md#canonical-gauntlet-ranking) for the
    full placement rules. Implemented by `canonicalGauntletRankMap()` in `src/lib/gauntlet-ranking.ts`
    — pass the result as `canonicalRanking` to `LeaderboardTable`. Returns an empty map while the
    gauntlet is in progress.
- **Regular ↔ gauntlet pairing** — each regular season has a companion gauntlet season (playoffs),
  matched **by name, not ID** (e.g. "Season 5" ↔ "Season 5 Gauntlet"). Always go through
  `extractSeasonNumber()` / `buildRegularToGauntletMap()` in `src/lib/util.ts`, or the
  `getLinkedGauntlet()` / `getLinkedRegularSeason()` query helpers — never assume adjacent IDs.
- **Pod** — the atomic unit of a gauntlet bracket: 4 players, 2 games, two distinct partner
  pairings (guaranteeing exactly one 2-0 and one 0-2 regardless of results). A pod's
  `advance_rule` is `single` (only the 2-0 survives) or `wildcard` (only the 0-2 is eliminated).
  Generated deterministically by `buildGauntletBracket(N)` in `src/lib/gauntlet-bracket.ts` and
  stored as a real FK graph in `gauntlet_pods`/`gauntlet_pod_slots`; materialized into playable
  `matches` rows by `src/lib/gauntlet-engine.ts` as the bracket progresses. See
  [`architecture.md`](./architecture.md#gauntlet-bracket-scheduling).
- **Gauntlet seeding projection** — the gold-bye/red-drop row tint on a regular season's own
  `LeaderboardTable`, never shown on a gauntlet season's own leaderboard (which gets a podium once
  complete instead — `GauntletStandings`). Computed by `SeasonTabView.tsx` and passed as the
  `gauntletSeeding` prop to `LeaderboardTable`; see
  [`calculations.md`](./calculations.md#gauntlet-seeding-projection) for the two sources it prefers
  between (a real materialized bracket vs. a live "if the season ended today" preview) and why.
  Distinct from the canonical gauntlet ranking below, which only ever describes a *completed*
  gauntlet.
- **H2H (Head-to-Head)** — cross-player comparison surfaced in `getH2HData()`. Two distinct shapes
  live inside `H2HData` (`src/lib/queries/h2h.ts`):
  - **Duos** (`DuoStats`) — performance when two players are *teammates* (same faction)
  - **Rivals** (`H2HStats`) — performance when two players are *opponents* (different factions)
  Rendered by `H2HMatrix.tsx` (overview grid) and `MatchupDetail.tsx` (drill-down for a pair —
  `DuoDetail`/`RivalDetail`, shared by the Statistics H2H tab, a player's Matchups tab, and a
  match's Scouting Report). Each pair's drill-down includes **Map Intel**: a per-pair,
  per-map record (`DuoStats.mapBreakdown` / `H2HStats.mapBreakdown`) aggregated directly from
  that pair's own match history — not from either player's individual career map stats.
- **Blended score** (H2H rankings) — how the "Best Friends"/"Closest Rivals" cards
  (`topDuos`/`topRivals` in `H2HSection.tsx`) rank pairs, and how the `H2HMatrix` colors
  its cells. Shared via `duoBlendedScorer`/`rivalBlendedScorer` in `src/lib/queries/h2h.ts`.
  Each metric that feeds the score (games played, wins, round win rate, meetings,
  win-difference) lives on its own scale — raw counts can run into the dozens, rates top
  out at 100, differences shrink toward 0 as a rivalry gets closer. To combine them into
  one weighted sum, each metric is normalized against the *best value seen for that metric
  across all eligible pairs* (e.g. `maxRwr` = the highest round win rate anyone posted),
  turning every term into a 0–1 "how close to the best?" fraction before the weights
  (0.5 / 0.3 / 0.2, etc.) are applied. `Math.max(1, ...)` guards the empty-data case.
- **Scouting report** — pre-match prep view (`getMatchScoutingData()` → `ScoutingReport.tsx`)
  showing each upcoming player's recent form/history before a match is played.
- **Bye** — a player who sits out a given week (`weeks.bye_player_id`); odd-numbered rosters mean
  someone rotates out each week.
- **Played match** — *not* simply "has a `final_score`." Season 3 matches were pre-staged with
  `"0-0"` placeholders before real scores were entered. Always gate on `isPlayedScore()` from
  `src/lib/util.ts`.
- **Career stats** — aggregated across seasons, always subject to the same `useSeasonFilter()`
  rules (`includeRegular` / `includeGauntlet` / `selectedSeason` / career) as every other view.
  See `getCareerLeaderboard()` and `CareerStatsView.tsx` — don't build a one-off filter.
- **Trusted auto-commit / D5 predicate** — `evaluateAutoCommit()` (`src/lib/demo/autoCommit.ts`)
  decides whether a parsed demo's score writes to the match automatically, skipping the human
  Confirm step. On by default; `AUTO_COMMIT_ENABLED=false` is the manual override. See
  [`hosting.md`](./hosting.md#trusted-auto-commit-138).
- **`map_result`** — MatchZy's own end-of-map webhook event, POSTed to `matchzy_remote_log_url` and
  captured at `mapResultKey`; the independent cross-check the D5 predicate corroborates the
  demo-derived score against.

## Where things live (file map)

| Concern | File(s) |
|---|---|
| All Supabase data-fetching | `src/lib/queries/` — split by domain behind a barrel `index.ts` (grep for `export async function get…`); see `docs/recipes.md`'s query-helper recipe |
| Shared types matching DB shape | `src/lib/types.ts` |
| Cross-cutting helpers (score parsing, season pairing, tab styles, formatting) | `src/lib/util.ts` |
| H2H (duo/rival) aggregation core | `src/lib/h2h.ts` |
| Player per-match stat aggregation (career/season/per-map) | `src/lib/player-stats.ts` |
| Canonical gauntlet finish-order ranking | `src/lib/gauntlet-ranking.ts` |
| Map name → image/slug lookups | `src/lib/maps.ts` |
| Season filter state (career/season/regular/gauntlet) | `src/components/SeasonFilter.tsx` |
| Veto sequence rendering | `src/components/VetoSequence.tsx` |
| H2H overview grid / drill-down | `src/components/H2HMatrix.tsx`, `src/components/MatchupDetail.tsx` |
| Pre-match prep view | `src/components/ScoutingReport.tsx` |
| Gauntlet bracket rendering | `src/components/GauntletRoundsList.tsx`, `src/components/GauntletStandings.tsx` |
| Gauntlet bracket generation + advancement engine | `src/lib/gauntlet-bracket.ts`, `src/lib/gauntlet-engine.ts` |
| Career vs per-season stat views | `src/components/CareerStatsView.tsx`, `src/components/SeasonTabView.tsx`, `src/components/CombinedSeasonTabView.tsx` |
| Pages (routes) | `src/app/**` — see the route table in [`architecture.md`](./architecture.md) |
| Historical CSV ingestion (Python, not deployed) | `ingestion/` |
| Discord account linking (OAuth2 → `players.discord_id`) | `src/lib/discordLinkState.ts`, `src/lib/discord-link.ts`, `src/app/api/auth/discord/`, `src/components/DiscordLinkButton.tsx` |
| Discord `#match-notifications` webhook alerts | `src/lib/discord-notify.ts` |
| Discord `@Participants` role sync | `src/lib/discord-roles.ts`, hooked from `src/app/api/seasons/[id]/players/route.ts` (POST/DELETE) and `src/lib/season-lifecycle.ts` (`activateSeason()`/`checkSeasonCompletion()`) |
| Discord name-color roles (per-player cosmetic role, `players.discord_name_role_id`) | `src/lib/discord-roles.ts` (`createNameRole()`/`renameNameRole()`/`deleteNameRole()`/`setDiscordRoleColor()`), hooked from the link/unlink/rename routes (`src/app/api/auth/discord/callback/`, `src/app/api/players/[id]/`, `src/app/api/players/me/discord/`, `src/app/api/players/me/name/`) |
| Discord slash commands (`/leaderboard`, `/scheduled`, `/player`, `/name-color`) | `src/lib/discordInteractions.ts` (Ed25519 verification, response shapes), `src/lib/discord-commands.ts` (handlers), `src/app/api/discord/interactions/route.ts`, `scripts/register-discord-commands.ts` (registers the command *definitions*, separate from serving them) |
| Discord weekly match-thread publish (`season-{N}` forum channel, `match_discord_state.thread_id`) | `src/lib/discord-threads.ts` (`publishWeekThreads()`), `src/app/api/seasons/[id]/discord-threads/route.ts`, `src/components/DiscordThreadPublisher.tsx` (admin console → Manage → Season) |
| Discord match-thread close on score report | `src/lib/discord-threads.ts` (`closeMatchThread()`), hooked from `src/app/api/matches/[id]/score/route.ts` alongside `notifyMatchScoreReported()` |

## Conventions to know before reading the query layer

- **`player_season_leaderboard` is the source of truth for aggregates** — `total_assists` and
  `total_rounds_won` are the two fields *missing* from it; `getSeasonBaseData()`
  (`src/lib/queries/leaderboard.ts`) patches those in from `player_match_stats`.
- **Map names are user-typed strings** — always `.toLowerCase()` before comparing; use
  `mapSlug()` from `src/lib/maps.ts` for URL segments.
- **`id` for routing/queries/props, `name` for display only** — don't key off display names.
- Most `get*` functions in `src/lib/queries/` return fully-shaped view-model objects (joins already
  done) — components should not need to re-derive joins that already exist there. If you find
  yourself writing one, it probably belongs in `src/lib/queries/` or `util.ts` instead (see
  `CLAUDE.md`).

---
*Keep this in sync as the schema/components evolve — a stale glossary is worse than none. If you
add a new domain concept (new season format, new stat type, new cross-cutting filter), add it here.*
