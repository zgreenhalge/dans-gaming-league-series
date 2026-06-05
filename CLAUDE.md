@AGENTS.md

## Guiding philosophy

**Keep it simple and learnable.** Prefer straightforward solutions over clever ones. Every implementation choice should be easy to understand, modify, and extend without needing to unravel abstractions. When there are two ways to do something, pick the one a newcomer could follow. This is a real constraint — favor obvious code over abstraction.

## Commands

See README.md for frontend npm commands. See `ingestion/README.md` for Python ingestion setup and commands.

## Environment

See README.md for the full env var list. One non-obvious constraint: `SUPABASE_SERVICE_ROLE_KEY` in the frontend is server-side only. Never put it in a `NEXT_PUBLIC_*` var.

## Architecture

### Database constraints
Full schema is in README.md and `src/lib/types.ts`. Non-obvious rules:

- **Always read aggregates from `player_season_leaderboard`** — never compute them client-side.
- **ADR is the primary sort key** on every leaderboard. Never sort by W-L alone.
- `total_assists` and `total_rounds_won` are absent from the view. `getPerPlayerSeasonStats()` in `src/lib/queries.ts` augments them by reading `player_match_stats` directly.
- **Gauntlet seasons** store all matches as `is_playoff_game = true`, so they're excluded from the regular view. Use `getGauntletStats()` / `getGauntletSeasonLeaderboard()` for gauntlet data.
- **RLS is off** on all tables. Enabling it without policies blocks all access.
- **Season ↔ gauntlet pairing is name-based.** Use `extractSeasonNumber()` from `src/lib/util.ts` — don't assume paired seasons have adjacent IDs.

### Frontend patterns
- **`src/lib/queries.ts`** — all data-fetching lives here. Don't write ad-hoc `supabase.from(...)` calls in page components.
- Server Components by default. API routes exist only for authenticated mutations.
- Dev mock auth providers (`dev-zach-mock`, `dev-dan-mock`) are active in `NODE_ENV=development` only — no Steam API key needed locally.
- **Played match check:** use `isPlayedScore(m.final_score)` from `src/lib/util.ts`. `null` alone is not sufficient — S3 matches were pre-staged with `"0-0"` before scores were entered.
- **Tab UI:** use `tabCls(active)` from `src/lib/util.ts` for the standard bordered-underline tab button style.
- **Score parsing:** use `parseScore()` from `src/lib/util.ts` — handles both `"13-9"` and `"13 – 9"` (em-dash).

## Gotchas

- League plays on CS2 Wingman **community workshop maps**, not the official active-duty pool. Don't hardcode official-map asset URLs.
- **Map names in the DB are user-typed strings** — always compare case-insensitively (`.toLowerCase()`). Use `mapSlug()` from `src/lib/maps.ts` for URL segments. To add a new map: drop a `.jpg` in `public/maps/<slug>.jpg` and add an entry to `MAP_IMAGES` in `src/lib/maps.ts`.
