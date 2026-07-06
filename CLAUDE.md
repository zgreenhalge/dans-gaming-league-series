@AGENTS.md

**New to this codebase (human or agent)?** All reference docs live in [`docs/`](./docs/) —
[`docs/README.md`](./docs/README.md)'s index table maps every area (routes, formulas, hosting,
replay, CSS, …) to its owning doc; treat that table as authoritative rather than any list here, since
it's the one place new docs get added. Read [`docs/glossary.md`](./docs/glossary.md) first: it
defines DGLS-specific domain terms (gauntlet, H2H, faction, RWR, etc.) and maps concepts to the files
that implement them. For cross-cutting conventions every change should follow, see
[`docs/patterns.md`](./docs/patterns.md).

When citing code in docs, comments, or commits, reference it by **symbol name** (e.g.
`getGauntletStats()` in `queries.ts`), never by line number — line numbers rot. See
[`docs/patterns.md`](./docs/patterns.md).

## Guiding philosophy

**Keep it simple and learnable.** Prefer straightforward solutions over clever ones. Every implementation choice should be easy to understand, modify, and extend without needing to unravel abstractions. When there are two ways to do something, pick the one a newcomer could follow. This is a real constraint — favor obvious code over abstraction.

**Always prefer extracting/abstracting shared logic whenever possible.** If you're about to write a join/aggregation/derivation that already exists elsewhere (even inline in a component), factor it into a shared helper (`src/lib/queries.ts` or `src/lib/util.ts`) and have both call sites use it — don't let two copies of the same logic drift apart.

**Artifacts describe the present, not the past.** Docs, code comments, config `note` fields — everything committed describes how things *are*, never how they changed. No dates, no changelog prose, no "previously / used to / re-enabled." This is a hard rule: see AGENTS.md's "Artifacts describe the present, not the past" and [`docs/patterns.md`](./docs/patterns.md). The lone exception is a deliberate decision log kept to avoid regressing to known-bad config.

## Working with the user

- **Questions and planning requests are not implementation triggers.** When the user asks "what could we do about X?" or asks for a plan, respond with analysis and stop — don't start editing until they say to proceed.
- **Read the doc that owns the area before changing code in it.** [`docs/README.md`](./docs/README.md)'s index table maps every area to its doc — check it rather than assuming from memory, since new docs get added there first. `docs/patterns.md`'s "Read the doc that owns the area" section has a quick-reference for the most common cases. The cross-cutting design heuristics — KISS, YAGNI, DRY, WYSIWYG, SOLID-as-modules, POLA — live in [`docs/patterns.md`](./docs/patterns.md). Reading first beats reverse-engineering, and you update the relevant doc in the same change that alters its behavior.
- **The user verifies UI on the deployed preview (often on their phone), not localhost.** Don't spin up the dev server to self-diagnose a visual change — you can't see the result and they don't expose localhost to the internet. Finish the change, hand it back, and let them test. Use `npm run build` to catch type/lint errors, not the dev server to "check" UI.
- **When a number looks wrong, investigate the data before changing code.** Stats often look off because matches were entered out of chronological order or pre-staged (S3's `"0-0"` rows) — not because the logic is broken. Confirm the data is what you think it is before restructuring a query or derivation to "explain" an anomaly. Reverting a needless logic change costs more than a `select`.
- **Git: commit only when asked, in logical groups, on a feature branch.** When the user asks you to commit, default to **multiple logically-grouped commits** (not one mega-commit) on a feature branch, then push and write a PR description. Never commit work the user hasn't confirmed. Cite code by symbol name in commit messages (see [`docs/patterns.md`](./docs/patterns.md)).

## Commands

See README.md for frontend npm commands. See `ingestion/README.md` for Python ingestion setup and commands.

## Environment

See README.md for the full env var list. One non-obvious constraint: `SUPABASE_SERVICE_ROLE_KEY` in the frontend is server-side only. Never put it in a `NEXT_PUBLIC_*` var.

## Architecture

### Database constraints
Full schema is in [`docs/architecture.md`](./docs/architecture.md) and `src/lib/types.ts`. Non-obvious rules:

- **Always read aggregates from `player_season_leaderboard`** — never compute them client-side.
- **Canonical sort is WR% → RWR% → ADR** (all descending). Use `canonicalSort()` from `src/lib/util.ts` everywhere player rows are ranked. Never sort by ADR alone.
- `total_assists` and `total_rounds_won` are absent from the view. `getPerPlayerSeasonStats()` in `src/lib/queries.ts` augments them by reading `player_match_stats` directly.
- **Gauntlet seasons** store all matches as `is_playoff_game = true`, so they're excluded from the regular view. Use `getGauntletStats()` / `getGauntletSeasonLeaderboard()` for gauntlet data.
- **RLS is off** on all tables. Enabling it without policies blocks all access.
- **Season ↔ gauntlet pairing is name-based.** Use `extractSeasonNumber()` from `src/lib/util.ts` — don't assume paired seasons have adjacent IDs.
- **Numeric precision is a storage-vs-display split.** Per-match `adr` in `player_match_stats` is stored as a whole number; aggregate ADR is *recomputed* from `total_damage / total_rounds_played` (see `overall_adr` in `queries.ts`) and is a true float — display layers show it at 2 decimals (`overall_adr.toFixed(2)`). Don't "fix" a decimal aggregate ADR to look like an integer, and don't massage match-card numbers — show them as stored.

### Frontend patterns
- **`src/lib/queries.ts`** — all data-fetching lives here. Don't write ad-hoc `supabase.from(...)` calls in page components.
- Server Components by default. API routes exist only for authenticated mutations.
- Dev mock auth providers (`dev-zach-mock`, `dev-dan-mock`) are active in `NODE_ENV=development` only — no Steam API key needed locally.
- **Played match check:** use `isPlayedScore(m.final_score)` from `src/lib/util.ts`. `null` alone is not sufficient — S3 matches were pre-staged with `"0-0"` before scores were entered.
- **Tab UI:** use `tabCls(active)` from `src/lib/util.ts` for the standard bordered-underline tab button style.
- **Score parsing:** use `parseScore()` from `src/lib/util.ts` — handles both `"13-9"` and `"13 – 9"` (em-dash).
- **Seasonal filter is universal.** Any view that aggregates stats across seasons must respect the same filter as the rest of the site — `useSeasonFilter()` / `<SeasonFilter>` from `src/components/SeasonFilter.tsx`, with the same `includeRegular`/`includeGauntlet`/`selectedSeason`/career semantics used by `getCareerLeaderboard()` and `CareerStatsView`. Don't build a one-off season selector.
- **Hover lift effects:** The codebase defines two hover interaction classes in `globals.css`:
  - **`lift-card`** — for standalone cards/panels/buttons that should rise on hover with a smooth `translateY(-2px)` transform and drop shadow. Use this for anything that should feel like it's floating above the page (hero cards, standalone result cards, clickable panels).
  - **`lift-row`** — for rows/cells in bordered containers (season lists, match grids, table rows). Uses an inset accent border and subtle background tint instead of transform (since `translateY` would create gaps between neighbors). Use this for all table rows and list items inside bordered containers.
  - Both classes support the `--lift-accent` custom property to override the hover accent color (useful for semantic colors like win/loss). The default is the site accent color.

## Gotchas

- League plays on CS2 Wingman **community workshop maps**, not the official active-duty pool. Don't hardcode official-map asset URLs.
- **Map names in the DB are user-typed strings** — always compare case-insensitively (`.toLowerCase()`). Use `mapSlug()` from `src/lib/maps.ts` for URL segments. To add a new map: drop a `.jpg` in `public/maps/<slug>.jpg` and add an entry to `MAP_IMAGES` in `src/lib/maps.ts`.
