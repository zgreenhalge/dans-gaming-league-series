# Patterns & Conventions

Cross-cutting guidelines that apply broadly across the codebase, independent of any one feature.
These are the habits that keep the project simple and keep this documentation from drifting. For
concrete step-by-step changes see [`recipes.md`](./recipes.md).

## Cite code by symbol, not by line number

Reference code by the **name** of the thing — `getGauntletStats()` in `src/lib/queries.ts`, the
`LeaderboardRow` type in `src/lib/types.ts` — never by line number (`queries.ts:824`). Line numbers
rot the instant anything above them changes, and a wrong line number is worse than none: it sends a
reader to unrelated code. Symbol names survive refactors and stay greppable. This applies to docs,
comments, commit messages, and PR descriptions alike.

## Centralize derivations; components only render

Any join, aggregation, or derivation belongs in the data/util layer (`src/lib/queries.ts`,
`src/lib/util.ts`), behind a helper that returns a **fully-shaped** value. Components should render
what they're handed, not re-derive it. If you catch yourself writing a `.reduce()`/join inside a
`.tsx` file, that's the signal to move it into a shared helper and have every call site use it — two
copies of the same logic will drift apart. This is the single most important structural rule in the
codebase.

## Derive from canonical sources, not ad-hoc recomputation

When a source of truth already exists, read it — don't recompute. Aggregates come from
`player_season_leaderboard`, not client-side math. Ordering comes from the documented canonical sorts
(`canonicalSort()`, `canonicalGauntletRankMap()`), not a one-off `.sort()`. "Did this match happen?"
comes from `isPlayedScore()`, not `final_score != null`. Reusing the canonical source keeps every
view consistent and means a fix lands in one place.

## Prefer shared primitives over re-rolling

Before hand-rolling layout, interaction, or styling, check whether a shared primitive already exists
and compose it instead. The codebase deliberately factors these out — stat-tile grids, tab bars,
season filters, the hover/lift classes, the responsive-table treatment — precisely so they stay a
*system* rather than drifting into per-component one-offs. See [`visual-conventions.md`](./visual-conventions.md)
for the visual primitives. When you genuinely need something new, ask whether it's a new *shape* or
just a new *parameter* (color, count) of an existing primitive — usually it's the latter.

## Document what *is*, and keep it in sync at change time

Docs describe the system as it currently works — not its history. No changelog entries, no "we used
to do X," no decision archaeology unless explicitly asked. When a change alters behavior, update the
relevant doc in the **same** change, and when you add a domain concept add it to
[`glossary.md`](./glossary.md). A stale doc is worse than no doc.

## Identifiers vs. display names

Use `id` for routing, queries, and props; treat `name` as display-only. Don't key logic off a
display string — names can collide, change, or be user-typed (map names especially are free-form and
must be compared case-insensitively).
