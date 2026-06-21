# Patterns & Conventions

Cross-cutting guidelines that apply broadly across the codebase, independent of any one feature.
These are the habits that keep the project simple and keep this documentation from drifting. For
concrete step-by-step changes see [`recipes.md`](./recipes.md).

## Read the doc that owns the area before you change it

These docs exist so you don't have to reverse-engineer intent from the code. Before editing in an
unfamiliar area, read the doc that owns it — [`README.md`](./README.md) maps every area to its doc:

- Changing a stat or ranking formula → [`calculations.md`](./calculations.md) **first** (the math is
  load-bearing and easy to get subtly wrong).
- A data-fetching/query helper → [`recipes.md`](./recipes.md) + [`glossary.md`](./glossary.md).
- A route, the mutation API, the schema, or deployment → [`architecture.md`](./architecture.md).
- CSS, hover/lift, layout, or a shared UI primitive → [`visual-conventions.md`](./visual-conventions.md).
- The EHOG rating engine → [`ehog.md`](./ehog.md) (and mirror any math change Python ↔ TS).
- The demo upload/parse pipeline → [`demo-ingestion.md`](./demo-ingestion.md).

Reading the right doc first is faster than guessing, and it stops you re-deriving something a helper
already does. The flip side is below in **Document what *is***: when your change alters behavior a
doc describes, update that doc in the **same** change.

## Design heuristics (the corny acronyms — and what they actually mean here)

Shorthand for the judgment calls this codebase makes constantly. They pull in slightly different
directions on purpose; the skill is knowing which one applies.

- **KISS — Keep It Simple.** The guiding philosophy (see [`../CLAUDE.md`](../CLAUDE.md)). Between two
  working solutions, ship the one a newcomer could follow. Clever is a cost you pay at every later read.
- **YAGNI — You Aren't Gonna Need It.** Don't add a config flag, generic parameter, abstraction
  layer, or DB column for a use case that doesn't exist yet. Build for the second *real* caller, not
  the imagined one — a speculative abstraction is harder to delete than a missing one is to add.
- **DRY — Don't Repeat Yourself**, with its counterweight. Two copies of a *derivation* must never
  drift — that's why `deriveRates()` and the `queries.ts` helpers exist. But don't DRY two things that
  merely *look* alike: `deriveRates()` is shared while each caller keeps its own summation, because
  the input shapes are genuinely different. Rule of three — extract on the third real repetition, not
  the first coincidence.
- **WYSIWYG — What You See Is What You Get.** A component renders what it's handed; it doesn't
  secretly recompute, refetch, or reorder. Reading a component's JSX should tell you what's on screen
  — derivations live in the data/util layer (see **Centralize derivations** below). Same spirit in
  docs: describe what *is*.
- **SOLID**, translated to this functional/module codebase — we favor **composition over
  inheritance** and there are almost no classes, so read these as module/component discipline:
  - **S**ingle responsibility — a `queries.ts` helper fetches + shapes; a component renders; an
    `api/` route validates + writes. Don't blur the three.
  - **O**pen/closed — extend a shared primitive by passing a new *parameter* (color, count, variant),
    not by forking it into a near-duplicate. Ask "new *shape* or new *parameter*?" — usually the latter.
  - **L/I/D** — depend on the shared helper and the domain types (`LeaderboardRow`, …), not on raw
    Supabase row internals; keep prop and return interfaces minimal and fully-shaped so call sites
    render rather than reach through them.
- **POLA — Principle of Least Astonishment.** Match the shape of the nearest existing example (every
  recipe links one). A reviewer should predict your code's behavior from its neighbors. Boring-but-
  obvious beats surprising-but-clever here, every time.

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
