# Glossary & Codebase Map

A vocabulary and orientation reference for DGLS — for new contributors and AI agents alike.
The README documents *what* the system does; this doc explains the *terms* and *where things live*
so you don't have to reverse-engineer them from scratch each time.

## League format & domain terms

- **Individual Rotating Mixer** — the league format. Teammates change every week (randomly drawn),
  so traditional W-L records say more about your draw than your skill. This is *why* the whole site
  is built around rate-based stats instead of win totals.
- **ADR (Average Damage per Round)** — the platform's primary individual skill metric; the
  *tertiary* tiebreaker in the canonical leaderboard sort (WR% → RWR% → ADR). Never sort by ADR
  alone — always apply `canonicalSort()` from `src/lib/util.ts`.
- **WR% (Win Rate)** — `wins / games_played`; the *primary* sort key in the canonical leaderboard
  sort. Stored as `total_wins / total_games` on `player_season_leaderboard`.
- **RWR% (Round Win Rate)** — `total_rounds_won / total_rounds_played`; the *secondary* sort key in
  the canonical leaderboard sort. Derived, not stored; see `LeaderboardRow.rwr_percentage` in
  `src/lib/types.ts`.
- **Canonical sort (regular season)** — the standard leaderboard sort order for regular-season and
  career views: **WR% → RWR% → ADR**, all descending. Implemented by `canonicalSort()` in
  `src/lib/util.ts`; see
  [`calculations.md`](./calculations.md#canonical-regular-season-ranking)
  for the full rationale. Not to be confused with the canonical *gauntlet* ranking below.
- **EHOG (rating)** — the DGLS player skill rating, an [OpenSkill](https://github.com/philihp/openskill.js)
  PlackettLuce model mapped onto a 10–100 display scale via a logistic transform. Match-outcome-based
  (win/loss + margin of victory), not individual-stat-based. Updated via full chronological recompute
  after every score submission. See [`ehog.md`](./ehog.md) for the full engine docs.
  Not to be confused with the aspirational *Player Rating* sabremetric composite in
  [`calculations.md`](./calculations.md#player-rating-aspirational--requires-demo-data).
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
  instead of round-robin weeks:
  - `weeks` rows represent **bracket rounds**, not calendar weeks
  - Veto is simultaneous (each side submits 2 bans at once, no turn order); 4 bans total auto-picks
    the remaining map
  - **All gauntlet matches are stored with `is_playoff_game = true`**, so the regular
    `player_season_leaderboard` view excludes them entirely — gauntlet stats must be computed
    directly from `player_match_stats` (`getGauntletStats`, `getGauntletSeasonLeaderboard`,
    `getGauntletRounds`)
  - **Canonical gauntlet ranking** — the official finish order for a completed gauntlet; see
    [`calculations.md`](./calculations.md#canonical-gauntlet-ranking) for the
    full placement rules. Implemented by `canonicalGauntletRankMap()` in `src/lib/util.ts` — pass
    the result as `canonicalRanking` to `LeaderboardTable`. Returns an empty map while the gauntlet
    is in progress.
- **Regular ↔ gauntlet pairing** — each regular season has a companion gauntlet season (playoffs),
  matched **by name, not ID** (e.g. "Season 5" ↔ "Season 5 Gauntlet"). Always go through
  `extractSeasonNumber()` / `buildRegularToGauntletMap()` in `src/lib/util.ts`, or the
  `getLinkedGauntlet()` / `getLinkedRegularSeason()` query helpers — never assume adjacent IDs.
- **H2H (Head-to-Head)** — cross-player comparison surfaced in `getH2HData()`. Two distinct shapes
  live inside `H2HData` (`src/lib/queries.ts`):
  - **Duos** (`DuoStats`) — performance when two players are *teammates* (same faction)
  - **Rivals** (`H2HStats`) — performance when two players are *opponents* (different factions)
  Rendered by `H2HMatrix.tsx` (overview grid) and `MatchupDetail.tsx` (drill-down for a pair —
  `DuoDetail`/`RivalDetail`, shared by the Statistics H2H tab, a player's Matchups tab, and a
  match's Scouting Report). Each pair's drill-down includes **Map Intel**: a per-pair,
  per-map record (`DuoStats.mapBreakdown` / `H2HStats.mapBreakdown`) aggregated directly from
  that pair's own match history — not from either player's individual career map stats.
- **Blended score** (H2H rankings) — how the "Best Friends"/"Closest Rivals" cards
  (`topDuos`/`topRivals` in `H2HSection.tsx`) rank pairs, and how the `H2HMatrix` colors
  its cells. Shared via `duoBlendedScorer`/`rivalBlendedScorer` in `src/lib/queries.ts`.
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
- **Interpolated match** (`is_interpolated`) — a historical match whose stats were estimated/filled
  in during ingestion rather than recorded live (see `ingestion/`). Treat with the same care as any
  imputed data when building stats views.
- **Played match** — *not* simply "has a `final_score`." Season 3 matches were pre-staged with
  `"0-0"` placeholders before real scores were entered. Always gate on `isPlayedScore()` from
  `src/lib/util.ts`.
- **Career stats** — aggregated across seasons, always subject to the same `useSeasonFilter()`
  rules (`includeRegular` / `includeGauntlet` / `selectedSeason` / career) as every other view.
  See `getCareerLeaderboard()` and `CareerStatsView.tsx` — don't build a one-off filter.

## Where things live (file map)

| Concern | File(s) |
|---|---|
| All Supabase data-fetching | `src/lib/queries.ts` (grep for `export async function get…`) |
| Shared types matching DB shape | `src/lib/types.ts` |
| Cross-cutting helpers (score parsing, season pairing, tab styles, formatting) | `src/lib/util.ts` |
| Map name → image/slug lookups | `src/lib/maps.ts` |
| Season filter state (career/season/regular/gauntlet) | `src/components/SeasonFilter.tsx` |
| Veto sequence rendering | `src/components/VetoSequence.tsx` |
| H2H overview grid / drill-down | `src/components/H2HMatrix.tsx`, `src/components/MatchupDetail.tsx` |
| Pre-match prep view | `src/components/ScoutingReport.tsx` |
| Gauntlet bracket rendering | `src/components/GauntletRoundsList.tsx`, `src/components/GauntletStandings.tsx` |
| Career vs per-season stat views | `src/components/CareerStatsView.tsx`, `src/components/SeasonTabView.tsx`, `src/components/CombinedSeasonTabView.tsx` |
| Pages (routes) | `src/app/**` — see the route table in [`architecture.md`](./architecture.md) |
| Historical CSV ingestion (Python, not deployed) | `ingestion/` |

## Conventions to know before reading the query layer

- **`player_season_leaderboard` is the source of truth for aggregates** — `total_assists` and
  `total_rounds_won` are the two fields *missing* from it; `getPerPlayerSeasonStats()` patches
  those in from `player_match_stats`.
- **Map names are user-typed strings** — always `.toLowerCase()` before comparing; use
  `mapSlug()` from `src/lib/maps.ts` for URL segments.
- **`id` for routing/queries/props, `name` for display only** — don't key off display names.
- Most `get*` functions in `queries.ts` return fully-shaped view-model objects (joins already done)
  — components should not need to re-derive joins that already exist there. If you find yourself
  writing one, it probably belongs in `queries.ts` or `util.ts` instead (see `CLAUDE.md`).

---
*Keep this in sync as the schema/components evolve — a stale glossary is worse than none. If you
add a new domain concept (new season format, new stat type, new cross-cutting filter), add it here.*
