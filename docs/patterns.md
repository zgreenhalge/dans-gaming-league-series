# Patterns & Conventions

Cross-cutting guidelines that apply broadly across the codebase, independent of any one feature.
These are the habits that keep the project simple and keep this documentation from drifting. For
concrete step-by-step changes see [`recipes.md`](./recipes.md).

## Read the doc that owns the area before you change it

These docs exist so you don't have to reverse-engineer intent from the code. Before editing in an
unfamiliar area, read the doc that owns it. **[`README.md`](./README.md)'s index table is the
authoritative, up-to-date map of every doc to its area** — the quick-reference list below covers the
most common cases but isn't exhaustive by design, so when in doubt check the index rather than
assuming this list is complete:

- Changing a stat or ranking formula → [`calculations.md`](./calculations.md) **first** (the math is
  load-bearing and easy to get subtly wrong).
- A data-fetching/query helper → [`recipes.md`](./recipes.md) + [`glossary.md`](./glossary.md).
- A route, the mutation API, the schema, or deployment → [`architecture.md`](./architecture.md).
- CSS, hover/lift, layout, or a shared UI primitive → [`visual-conventions.md`](./visual-conventions.md).
- The EHOG rating engine → [`ehog.md`](./ehog.md) (and mirror any math change Python ↔ TS).
- The demo upload/parse pipeline → [`demo-ingestion.md`](./demo-ingestion.md); the demo-format/parser
  library itself (not DGLS's use of it) → [`demo-parsing-reference.md`](./demo-parsing-reference.md).
- DatHost/MatchZy server hosting + auto-ingestion → [`hosting.md`](./hosting.md); general
  DatHost/MatchZy/CounterStrikeSharp knowledge (not DGLS's use of it) →
  [`cs2-stack-reference.md`](./cs2-stack-reference.md).
- The 2D replay / core-events / heatmap pipeline → [`replay.md`](./replay.md).
- A new background-job GitHub Action → [`github-actions.md`](./github-actions.md).

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
  drift — that's why `deriveRates()` and the `queries/` helpers exist. But don't DRY two things that
  merely *look* alike: `deriveRates()` is shared while each caller keeps its own summation, because
  the input shapes are genuinely different. Rule of three — extract on the third real repetition, not
  the first coincidence.
- **WYSIWYG — What You See Is What You Get.** A component renders what it's handed; it doesn't
  secretly recompute, refetch, or reorder. Reading a component's JSX should tell you what's on screen
  — derivations live in the data/util layer (see **Centralize derivations** below). Same spirit in
  docs: describe what *is*.
- **SOLID**, translated to this functional/module codebase — we favor **composition over
  inheritance** and there are almost no classes, so read these as module/component discipline:
  - **S**ingle responsibility — a `queries/*.ts` helper fetches + shapes; a component renders; an
    `api/` route validates + writes. Don't blur the three.
  - **O**pen/closed — extend a shared primitive by passing a new *parameter* (color, count, variant),
    not by forking it into a near-duplicate. Ask "new *shape* or new *parameter*?" — usually the latter.
  - **L/I/D** — depend on the shared helper and the domain types (`LeaderboardRow`, …), not on raw
    Supabase row internals; keep prop and return interfaces minimal and fully-shaped so call sites
    render rather than reach through them.
- **POLA — Principle of Least Astonishment.** Match the shape of the nearest existing example (every
  recipe links one). A reviewer should predict your code's behavior from its neighbors. Boring-but-
  obvious beats surprising-but-clever here, every time.

## A caught failure must always surface

A `catch` block that neither throws, nor logs, nor records anything is invisible — the operation
looks stuck or successful instead of failed, and nobody investigates until a player notices missing
data. Every catch site picks one of:

- **Throw** — abort so the caller's own handling takes over. The default for a background-job
  script's own state-machine writes: `jobStatusWriter` (`src/lib/background-jobs.ts`) throws on a
  failed write, aborting the run via the script's top-level `main().catch(fail)` rather than leaving
  the row stuck at its last-written stage looking like a hang. All three job scripts
  (`demo-ingest.ts`, `replay-extract.ts`, `radar-build.ts`) build their `setJob` from this factory; a
  script's own `fail()` is the one exception, writing directly via `recordJobStatus` since it must not
  throw while already unwinding.
- **Record to the DB** — for a best-effort operation riding along with a primary action that must not
  roll back on this failure (a gauntlet auto-seed, an EHOG recompute), use `recordOpsError()`
  (`src/lib/ops-errors.ts`); read back via `getOpsErrors()` on the admin ops-errors surface. Both this
  and the `background_jobs` failure state read through an admin dashboard rather than only
  `console.error`, since app logs aren't visible to an admin deciding what to do next.
- **Log** — the last resort, for a failure that's genuinely inconsequential (already covered by a
  retry elsewhere, or redundant with a warning surfaced some other way).

Pick one policy per call site and apply it for the same reason across every script/route that shares
the shape — don't let equivalent call sites disagree on whether a write failure aborts, gets recorded,
or vanishes.

## Don't caption a page instead of designing it

A page never gets a subheading whose only job is to narrate what the UI below it already shows
("Pick a map and start the shared server — no roster, no stats, first come first served."). If a
page's purpose or controls aren't legible from their own layout, labels, and affordances, that's a
design gap — fix the design, don't paper over it with explanatory prose. A heading names the page; it
doesn't summarize the page.

## Cite code by symbol, not by line number

Reference code by the **name** of the thing — `getGauntletStats()` in `src/lib/queries/gauntlet.ts`, the
`LeaderboardRow` type in `src/lib/types.ts` — never by line number (`gauntlet.ts:824`). Line numbers
rot the instant anything above them changes, and a wrong line number is worse than none: it sends a
reader to unrelated code. Symbol names survive refactors and stay greppable. This applies to docs,
comments, commit messages, and PR descriptions alike.

## Reference issues in a PR body with a closing keyword

A PR that addresses a tracked issue must reference it with a GitHub closing keyword — `Closes #123`,
`Fixes #123`, or `Resolves #123` — not a bare `#123`. Only the closing keywords auto-close the issue
when the PR merges; a bare reference just links it, leaving it open indefinitely with no signal that
it shipped. Use one line per issue if a PR addresses several. If a PR only partially addresses an
issue (follow-up work remains), don't use a closing keyword — reference it plainly instead and leave
the issue open.

## Centralize derivations; components only render

Any join, aggregation, or derivation belongs in the data/util layer (`src/lib/queries/`,
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

## Gate a tab on data, not "always render it"

A tab or sub-tab (`TabBar`/`tabCls` navigation) shouldn't render for a viewer who can only ever see
it empty. Before adding a tab, ask: does the underlying data exist yet, and if not, can *this viewer,
on this page* do something to produce it? Show the tab when either is true; hide it otherwise.

- **Data exists** — gate on the same signal the tab's content depends on, computed unscoped by
  whatever transient filter (season, side, …) the page also applies, so the tab doesn't flicker in
  and out as the user toggles that filter. `PlayerView`'s Trophy Case tab (`trophies.length > 0`) and
  Pathing tab (has a match with `replay_status === 'ready'`, from the full career `history`, not
  the season-filtered `filtered` — a played match alone isn't enough, since a replay may not exist for
  it yet) both follow this.
- **The viewer can produce the data here** — if the tab itself carries a generate/upload/dispatch
  action (an admin or in-match player can trigger it from that exact tab), show it regardless of
  current data so that action is reachable. `MatchRecapTab`'s 2D Replay sub-tab is always shown
  because its own empty state is a "Generate replay" button; its Heatmap and Pathing sub-tabs
  have no such action of their own (they only ever consume a replay generated from the 2D Replay
  tab), so they stay gated on the replay actually existing (`events`) instead.

Don't invent a third "show it anyway, it'll say 'no data'" tab — that's the case this rule exists to
prevent: a normal viewer gets a dead-looking tab with nothing to do about it.

## Document what *is*, not how it changed

**This applies to every committed artifact — docs, code comments, README / `note` / config fields,
`.cfg` files, tracked JSON — not just files under `docs/`.** Each describes how the system works
*now*, never how it got there. AGENTS.md's "Artifacts describe the present, not the past" is the
hard-rule statement; this is the working detail.

Cut on sight: dates, changelog prose, and the tells `previously / used to / earlier / re-enabled /
now / we discovered / confirmed live / disproved`, plus any past incident or prior version cited *as
explanation*. Rationale for a **current** choice stays (`X is set because Y`); narration of the
**change** goes (`X was Z, flipped to Y after W broke`).

**Litmus test:** if a sentence only makes sense to someone who saw the previous version, delete it.
The "why it changed" belongs in the commit message, PR, or conversation — never in the tree.

**One exception:** a deliberately maintained decision log kept to prevent regressing to a known-bad
configuration (e.g. the "Issues we've hit and how they were resolved" table in
[`cs2-stack-reference.md`](./cs2-stack-reference.md)) — in its one designated place, framed as forward
guidance, not scattered elsewhere.

When a change alters behavior, update the relevant doc in the **same** change, and when you add a
domain concept add it to [`glossary.md`](./glossary.md). A stale doc is worse than no doc.

## Client-only values: dates, times, and hydration safety

Server-rendered HTML must match the client's first render pass. Anything that depends on the user's
timezone, locale, or the current clock produces different values on the Vercel server (UTC) and the
user's browser — React will either warn or silently show the wrong value until hydration corrects it.

**Rules:**

1. **Locale-sensitive date/time formatting** (`toLocaleString`, `toLocaleDateString`, weekday names,
   12h vs 24h) must be **deferred to the client**. Use the `<LocalTime>` component for inline
   formatted timestamps, or `useSyncExternalStore` (see `useIsClient()` in `MatchHeaderSection`) to
   gate formatting behind a client-only check that returns `null` during SSR.
2. **Calendar-only dates** (no time-of-day component — e.g. season start dates, week windows) can
   render on the server if you pin both the `Date` constructor and the formatter to UTC:
   `new Date(str + 'T00:00:00Z').toLocaleDateString('en-US', { ..., timeZone: 'UTC' })`.
3. **`Date.now()` / `new Date()`** in render-time code (including `useState` initializers) will
   differ between server and client. Move these into `useEffect` so the value is only computed on
   the client.
4. **Never use `suppressHydrationWarning` to paper over a timezone mismatch.** It silences the React
   warning but the user still sees incorrect content flash on first load. Fix the root cause instead.

**Correct patterns already in the codebase:**

- `<LocalTime>` — uses `useSyncExternalStore` to return `null` on the server and format on the
  client only.
- `<CountdownTimer>` — initializes state to `null` and computes in `useEffect`.
- `useCountdown()` in `MatchHeaderSection` — initializes to `''`, populates via `useEffect`.
- Server components (e.g. `page.tsx`) using `toLocaleDateString` with `timeZone: 'UTC'` — safe
  because server components never hydrate.

## Identifiers vs. display names

Use `id` for routing, queries, and props; treat `name` as display-only. Don't key logic off a
display string — names can collide, change, or be user-typed (map names especially are free-form and
must be compared case-insensitively).
