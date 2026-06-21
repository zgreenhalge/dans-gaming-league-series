# Development Recipes

Step-by-step patterns for the changes made most often in this codebase. Each recipe links to a real
example already in the repo — read that example before writing new code in the same shape. See also
[`glossary.md`](./glossary.md) (domain vocabulary + file map),
[`visual-conventions.md`](./visual-conventions.md) (shared CSS utilities), and
[`calculations.md`](./calculations.md) (stat formulas and ranking rules).

## Recipe: Add a new aggregated stat / metric

The hardest part is deciding **where the number gets computed** — get this wrong and you'll end up
with logic duplicated across components. Decision order:

1. **Is it already in `player_season_leaderboard`?** If yes, just read it — see
   `getSeasonLeaderboard()` / `getCareerLeaderboard()` in `src/lib/queries.ts`. Never recompute
   something the view already provides.
2. **Is it derivable from fields the view *does* expose** (e.g. a percentage/ratio of two existing
   columns)? Compute it once in the query layer and attach it to the row type — see
   `rwr_percentage` on `LeaderboardRow` (`src/lib/types.ts`), derived in
   `getSeasonLeaderboard()`/`getCareerLeaderboard()` as `total_rounds_won / total_rounds_played * 100`.
3. **Is it missing from the view entirely** (like `total_assists`/`total_rounds_won`)? Augment it by
   reading `player_match_stats` directly and merging — the canonical pattern is
   `getPerPlayerSeasonStats()` in `src/lib/queries.ts`, called from every leaderboard-shaped
   query (`getSeasonLeaderboard`, `getCareerLeaderboard`, `getAllLeaderboards`) via `Promise.all`.
4. **Is it gauntlet-specific?** Gauntlet matches are excluded from the view entirely
   (`is_playoff_game = true`), so gauntlet stats are *always* computed directly from
   `player_match_stats` — see `getGauntletStats()` in `src/lib/queries.ts`.
5. **Is it map-specific** (pick/ban/win counts per map)? Follow the accumulator-map pattern in
   `getMapIndex()` in `src/lib/queries.ts` — iterate played matches once, build
   `Map<mapKey, Map<seasonId, count>>` accumulators, then shape into `MapSeasonStat[]`
   (`src/lib/types.ts`). Always gate on `isPlayedScore()` and `.toLowerCase()` map names.

In all cases: **the helper lives in `queries.ts`, returns a fully-shaped value, and components just
render it.** If you find yourself writing a join/reduce inside a `.tsx` file, that's the signal to
move it — see the "Always prefer extracting/abstracting shared logic" rule in `CLAUDE.md`.

When you aggregate per-match stats into a leaderboard row, sum the totals however the input shape
requires but derive the four canonical-sort fields (`win_rate_percentage`, `kd_ratio`,
`rwr_percentage`, `overall_adr`) through `deriveRates()` in `src/lib/util.ts` — it's the single
source for those divisions so the rankings can't drift between the player, career, and map views.

If the new stat should appear on **career views**, it must respect `useSeasonFilter()` the same way
`getCareerLeaderboard()` and `CareerStatsView.tsx` do — don't build a parallel filter.

## Recipe: Add a new page / route

Follow the shape of an existing dynamic route, e.g. `src/app/players/[id]/page.tsx`:

1. **Server Component by default.** Fetch everything in `Promise.all` at the top of the async page
   function — see `getPlayer` + `getCareerLeaderboard` + `getH2HData` fetched together in
   `players/[id]/page.tsx`.
2. **Validate route params and `notFound()` early** — `Number(id)` → `Number.isFinite()` check →
   `notFound()` before the data fetch, then `if (!detail) notFound()` after.
3. **Set `export const revalidate = N`** (ISR) — most detail pages use `60`.
4. **Add `generateMetadata()`** for the page `<title>`.
5. **Wrap content in `<TopbarShell>`** and delegate the actual rendering to a `components/*View.tsx`
   client/server component — keep the page itself thin (param handling + data fetching only).
6. **Add the route to the table in [`architecture.md`](./architecture.md)** once it's live.

## Recipe: Add a new query helper to `queries.ts`

1. Name it `get<Noun>()` / `get<Noun>Data()` and have it return a fully-joined, fully-shaped object
   — never a raw Supabase row that the component has to massage further.
2. Define its return shape as an `interface` near the top of `queries.ts` (or in `types.ts` if it
   mirrors a DB table) — see `H2HData`/`H2HStats`/`DuoStats` in `queries.ts` for an
   example of a multi-shape result type.
3. Batch independent Supabase reads with `Promise.all` and check `error` once, immediately —
   match the destructuring style in `getPerPlayerSeasonStats()`.
4. If the new helper needs season pairing (regular ↔ gauntlet), use `extractSeasonNumber()` /
   `buildRegularToGauntletMap()` from `src/lib/util.ts` or `getLinkedGauntlet()`/
   `getLinkedRegularSeason()` — **never** assume adjacent IDs (see [`glossary.md`](./glossary.md)).
5. Gate "did this match actually happen" on `isPlayedScore(m.final_score)`, not `final_score !=
   null` — Season 3 has `"0-0"` placeholder rows.

## Recipe: Add a new map

Pure asset task, no query changes:

1. Drop a `.jpg` into `public/maps/<slug>.jpg`
2. Add an entry to `MAP_IMAGES` in `src/lib/maps.ts`
3. Use `mapSlug()` for the URL segment — map names are user-typed strings, always compare
   case-insensitively

## Recipe: Add a new season-scoped view (career-style filtering)

If the view aggregates across seasons (like `CareerStatsView`, `H2HMatrix`):

1. Use `useSeasonFilter()` / `<SeasonFilter>` from `src/components/SeasonFilter.tsx` — don't build a
   one-off season selector
2. Respect the same `includeRegular` / `includeGauntlet` / `selectedSeason` / career semantics that
   `getCareerLeaderboard()` uses
3. If the view needs a tab UI (regular/gauntlet/career toggle), use `tabCls(active)` from
   `src/lib/util.ts` for the standard bordered-underline style — don't hand-roll tab classes

## Recipe: Style a new hoverable surface

Before writing new hover/transition CSS, check [`visual-conventions.md`](./visual-conventions.md):
pick `.lift-card` (standalone panels), `.lift-row` (flush table/list rows), or the `.map-card-bg`
accent ring (image-backed cards) based on the element's *shape*, and override `--lift-accent` only
if the element carries a semantic color (win/loss) that should survive hover.

## General checklist before opening a PR

- `npm run build` (type-checks + lints via the build)
- `npm run lint`
- `npm test` — unit tests for the pure invariants in `util.ts` (canonical sort, played-match check,
  score parsing, season pairing, `deriveRates`). If you touched any of those, add a case in
  `src/lib/util.test.ts` (zero-dependency `node:assert` runner, run via `tsx`).
- If you touched `queries.ts`, double check you didn't duplicate a join/derivation that already
  exists — grep for the field name first
- If you added a domain concept (new season format, new stat, new filter), add it to
  [`glossary.md`](./glossary.md)
- Cite code by **symbol name** (`getGauntletStats()` in `queries.ts`), never by line number —
  line numbers rot the moment the file changes. See [`patterns.md`](./patterns.md).
