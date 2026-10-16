# Visual Conventions ("Broadcast Chrome")

The site's visual language — a CS2-broadcast-inspired theme with a light "Dust2 daylight" mode and
a dark "broadcast HUD" mode. This doc names the shared utilities in `src/app/globals.css` so the
visual language stays a *system* instead of drifting into one-off classes per component.
**Reach for these before writing new hover/glow/accent CSS.**

## Theme tokens

Both themes are defined as CSS custom properties on `:root` / `[data-theme="dark"]` — never hardcode
hex colors in components. Key groups:

- `--color-bg-{primary,secondary,tertiary}`, `--color-text-{primary,secondary}`,
  `--color-border-{primary,secondary,tertiary}` — base surface palette
- `--color-accent-{green,amber,blue,red}-{bg,fg,strong,border,...}` — semantic status colors
  (win/pick/info/loss-ish meanings; green=win, red=loss, amber=pending/pick, blue=CT-ish info)
- `--color-ct` / `--color-t` — faction colors (swap meaning between light/dark themes — see below)
- `--color-site-accent` — the "lead" brand accent. **It is theme-dependent**: T-orange in light
  mode, CT-cyan in dark mode (`var(--color-t)` vs `var(--color-ct)`). Use this token, not a raw
  faction color, whenever you mean "the site's accent" rather than "this specific faction."
- `--overlay-{strong,medium,weak}`, `--map-img-filter[-boost]` — tuned per-theme for legibility and
  vibrancy over map background images

## Hover treatments — pick the right one for the shape

Three variants exist because flat translate/shadow effects break differently depending on whether
the element is a standalone card, a flush row sharing borders with siblings, or an image-backed
card. **Don't write a new hover effect — extend this set.**

| Class | Use for | Mechanism |
|---|---|---|
| `.lift-card` | Standalone panels, map tiles — anything with its own margin/shadow space | `translateY(-2px)` + border-color + drop shadow |
| `.lift-row` | Flush rows/cells sharing borders with siblings (season lists, schedules, gauntlet rounds, stat tables, this/next-week panels) — `translateY` would create gaps or bleed onto neighbors here | `inset box-shadow` (self-clipped) + accent-tinted background wash |
| `.map-card-bg:not(.lift-card)` (the "accent ring") | Image-backed cards that aren't already `.lift-card` | `outline` with negative offset — the only paint mechanism that sits *above* the `::before` map-image layer regardless of z-index |

All three read the **`--lift-accent` custom property** for their hover accent color, falling back to
`var(--color-site-accent)`. Set `--lift-accent` inline on an element when it carries a *semantic*
border color that should survive hover (e.g. `MatchCard` sets it to the win/loss color so a losing
match's card doesn't flip to the site accent on hover).

## Atmosphere & chrome

- **`.dgls-atmosphere`** — the page-level ambient glow (fixed radial gradients bleeding from the
  corners, faction-colored). Applied once, to the body in `layout.tsx`. The corner gradient
  deliberately carries the *counter*-accent color (CT in light mode, T in dark) — the inverse of
  `.accent-stripe`'s "accent leads" convention — so the glow reads as "the other side's" presence.
  Don't reapply this per-page; it's a global layer.
- **`.accent-stripe`** — the two-tone gradient bar (T→CT in light, CT→T in dark — site accent leads)
  used on chrome edges like the topbar. Matches the site-accent left-border convention used on
  hero/panel edges elsewhere.
- **`.live-dot`** / **`.sheen`** — shared motion utilities for "this is live/active" signals
  (pulsing dot, hover sheen sweep across cards). Both respect `prefers-reduced-motion`.

## Faction styling

Once a match's veto resolves, wrap the relevant scope in `.faction-ct` / `.faction-t` to set the
`--faction` custom property, then use:
- `.faction-fg` / `.faction-border` — text/border picks up the faction color
- `.faction-rule` — adds a 3px colored left rule (via `::before`)
- `.faction-tint` — subtle 10%-mixed background tint in the faction color

## Status & form indicators

- **`.wl-chip` / `.wl-chip--{win,loss,pending}` / `.wl-chip--sm`** — the canonical W/L/pending badge.
  Don't build ad-hoc colored pill markup for match results — use these.
- **`.form-square` / `.form-dot`** (`--w` / `--l` modifiers) — recent-form history indicators
  (squares for emphasis, dots for compact inline use)
- **`.player-name-me`** / `.player-highlight` / `.current-player-row` — "this is you" / "this is the
  player whose page you're on" treatments. See also `PlayerName.tsx`.
- **`<InfoTooltip>`** (`InfoTooltip.tsx`) — the "?" badge that reveals a fuller explanation on hover
  or keyboard focus. Reach for this whenever a label needs more than a one-line `title` attribute
  can hold (multi-line or formatted text); use a plain `title` for a single short sentence instead.

## Typography

- **`.font-display`** / **`.font-mono`** — the two custom font families
- **`.tracked`** / **`.tracked-wide`** — uppercase, letter-spaced "broadcast label" styling for
  small section headers/eyebrows. Table header cells are plain sans instead (see Table header cells)
- **`.display-numeral`** (with optional **`.ghost`**) — large hero stat numerals; `.ghost` gives a
  transparent-fill outlined look via `.ghost-accent`'s text-stroke technique
- The `.text-[Npx]` overrides bump several common Tailwind arbitrary font sizes ~10% for
  readability — this is intentional and global; don't fight it with more arbitrary sizes

## Map imagery

`.map-card-bg` is the shared wrapper for any card with a map-image background:
- Pass the image via the `--map-img` custom property (consumed by the `::before` pseudo-element,
  which sits at `z-index: -1` and applies the theme's `--map-img-filter`)
- Add `.light-boost` for cards that need the stronger `--map-img-filter-boost` (e.g. smaller/denser
  thumbnails where the base filter reads as washed out)
- `.map-text-scrim` / `.map-no-img` handle text legibility over images and the no-image fallback
  gradient respectively

## Tables & data display

**Avoid single-row tables.** A table whose body renders exactly one data row reads poorly — many
columns of headers above a single line of values, forcing horizontal scroll on mobile while wasting
vertical space. This happens most often when a multi-row leaderboard component is reused for a single
subject (e.g. the Advanced Stats tab on `/players/<id>` reusing the league sabremetrics tables).

When a table would have one data row, **transpose it into a label/value layout** instead:
- Use the shared **`StatTileGrid`** (`src/components/StatTileGrid.tsx`): pass a `tiles` array of
  `{ label, value, title?, valueStyle? }` and an optional responsive `columns` spec. It renders one
  bordered container with 1px grid-line dividers — the same shape as the player Overview stat panel
  (`PlayerView`) and the single-player Advanced Stats (`SinglePlayerStats` in
  `SabremetricsLeaderboardView.tsx`), so the two never drift.
- Keep the same metrics, formatting helpers, and `title` tooltips as the table — only the shape
  changes.

Tables remain the right choice the moment there are multiple rows to compare across the same columns.

**Tab bar + filter controls.** Use the shared **`TabBar`** (`src/components/TabBar.tsx`) for any page
with a row of tab buttons plus filter controls (season filter, side checkboxes, etc.). It owns the
`flex-wrap` layout that keeps the controls from overrunning the page on narrow viewports — tabs as
children, controls in the `controls` slot (pushed right via `ml-auto`), `bordered` for the standard
bottom rule. Don't hand-roll a `flex justify-between` tab row; it won't wrap. This is also the *only*
tab visual language on the site — a page-level tab row, a panel's internal status filter, and a
card's own sub-view switch should all render as `TabBar`/`tabCls()`, sized or spaced via a prop
rather than a second, differently-styled tab control. Two tab components that look different for no
reason reads as two unrelated features, not one drill-down.

**Stat tables.** A stat table is built from the shared pieces in `src/components/StatTable.tsx` and
the headers in `Th` / `SortableTh` — never a re-typed class string. One standard covers the
leaderboard, the season and career Stats and Advanced Stats tables, the player, match, map and
statistics pages, and the week/round/group scorecards:

| Piece | Standard |
|---|---|
| **`StatTable`** (frame) | A bordered card with the page background, scrolling sideways when columns overflow. `bare` drops the border inside a bordered container; `tinted` leaves the background to a faction-tint class (inside a `FactionTintContext.Provider`, a faction-tinted container such as the match page's per-team Advanced Stats blocks, every `StatTable` and `Tr` does this on its own); `fixed` lays the columns out equally (the name cell adds `truncate`); `header` puts a banner inside the frame above the table (the scouting report's map image). |
| **`Tr`** (row) | `--color-border-tertiary` divider, none under the last row (the card's border closes the table), on an opaque page background (a pinned cell inherits it). `clickable` adds the `lift-row` highlight; rows that aren't clickable don't highlight. `href` makes the row a link, `accent` tints it, `variant` sets a summary or marker row (below), `tinted` leaves the background to a faction-tint class. `accent`, `tinted` and a non-body `variant` each own the row's background, so use one. |
| **`NameTd`** (name cell) | Display font, 14px semibold. `sticky` pins it. |
| **`PlayerCell`** (player name) | A `NameTd` linking to `/players/<id>`, pinned unless `sticky={false}` (a fixed-layout table that fits its frame); `avatarUrl` adds the avatar. Use it for a plain player name; a row that adds a badge or the "me" highlight (`PlayerName`) builds its own `NameTd sticky` cell. `MapCell` is the map-name equivalent. |
| **`Td`** (figure cell) | Mono 12px with tabular digits, right-aligned (`align` overrides). `muted` greys a secondary figure, `bold` emphasises a headline one, `mono={false}` is the escape hatch for a column of text. |
| **Padding** | 8px on every side, headers and body cells alike, pinned name column included. Expanded-detail panels (`ExpandedTd`) are exempt. |

**Clickable rows.** A row that opens a page is `<Tr href="/players/7">`; its figure cells are plain
`Td`s. The name cell (`PlayerCell`, or a `NameTd` holding a `Link`) carries the row's one real link, so
keyboard users Tab to it, a screen reader announces one link per row, and right-click offers the usual
link menu. A click anywhere else on the row navigates (`router.push`), Cmd/Ctrl/Shift-click or a middle
click opens a new tab, and a click that lands on a link or control inside the row is left to it. The row
outlines while anything in it has focus. A row that expands or selects instead of navigating (the matchups
tables) uses `clickable` with its own `onClick`, and its `PlayerCell` takes `onToggle` and `expanded`
for a ▸/▾ button before the name, so the row reads as expandable and keyboard users can open it. `accent="<color>"` tints a row (the leaderboard's medal
and gauntlet-zone colors) and sets the `--lift-accent` the hover wash and bar use on a clickable row, so a tinted row
needs no hover handlers.

**Summary, marker and expanded rows.** `Tr variant="summary"` is an averages or totals row: tertiary
background (distinct from the secondary header band) under a tertiary top rule (the players and league averages in the scouting report, the "All
maps" footer). `Tr variant="marker"` sets one row apart inside a body: a light fill between white rules
(the "Current" rating among the EHOG projection scenarios). `ExpandedTd` is the full-width panel under
an expanded row: 12px padding on the secondary background, spanning every column of the header row so the
table never counts its columns.

**Table header cells.** `Th` (plain columns) and `SortableTh` (columns that sort) share one look:
10px semibold plain sans (no letter-spacing, not uppercased), 8px padding on every side, on a tinted
header band with a bottom rule. A long label wraps onto a second line at its spaces only (never inside a
hyphenated or slashed word) rather than widening its column; body cells never wrap, so a column is as
wide as its widest figure or name. `align="left"|"right"|"center"` aligns the label with the figures
below it; `sticky` on the first (name) cell pins it while the table scrolls sideways (`.sticky-col`, which also
paints the band so scrolled cells never show through).

`SortableTh` is a `<button>` inside the `<th>`, so Tab reaches it and Enter or Space sorts, with a
focus ring and a hover tint, and `aria-sort` announces the sorted column and direction. Its sort
arrow appears after the label of the sorted column only and nudges the label aside rather than
reserving space; a label that wraps keeps the arrow beside it. It reads its state from `useSortState()`
(`src/components/useSortState.ts`) or any `{ col, asc }` pair, so a table that keeps its own sort
state passes `state={{ col, asc }}`.

**Compact tables inside cards.** A table that sits inside a card (the player page's trophy stat strip,
a matchup's per-map breakdown) is built from `CompactTable`, `CompactTh`, `CompactTr`, `CompactTd` and
`CompactNameTd` (`src/components/CompactTable.tsx`) instead of the stat-table pieces. It has no frame and
no header band: a small uppercase label (wrapping at spaces only, like `Th`) above 11px mono figures that never wrap, with 4px of vertical padding, each body
row divided by a tertiary rule. `CompactTable` fills its container; give it `widths` (one Tailwind width
class per column) for a fixed layout that shrinks to those widths. `CompactTd` takes `align` and `bold`;
`CompactNameTd` is the truncating, linked name cell.

**Shared formatting helpers** (`src/lib/util.ts`) — use these instead of a local copy: `fmtPct(num, den)`
for whole-number percentages (`—` on a zero denominator), `factionClass(side)` for the `faction-ct` /
`faction-t` tint class (the class counterpart of `sideColor()`), `formatCountdownClock(ms)` and
`formatCountdownRelative(iso)` for countdowns, and `fmtWindowDate(date)` / `fmtWindowDay('YYYY-MM-DD')` for
a week-window date.

**Tables that keep their own spacing.**
- The stat-entry table in the demo upload modal uses `Th` for its headers and keeps its own 4–6px
  body padding, since its cells hold inputs.
- The admin tables (`PlayerManager`, `AdminActivityFeed`, `PlayerRow`) are intentionally different and
  stay on their own markup.

**List-style rows.** Cards with images, avatars and two-line content (`MatchCard`, `UpcomingGamesPanel`,
the seasons list, `SeasonRosterPanel`, `MapPoolPicker`, H2H rows, `MatchManager`) are not tables. Every
one already shares the frame-and-divider recipe of a table: a `lift-row` on clickable rows only, a
`--color-border-tertiary` divider, and `last:border-b-0` so the container's border closes the list. What
differs is padding, from 8px to 20px vertically and 12px to 24px horizontally. Some of that carries
meaning and some is drift:
- *Meaningful:* page-level lists with two lines of content (the seasons list, the home page rows) sit
  roomier than dense in-card lists (H2H section rows, the roster, map pool, and match management); an
  image-backed row (`MatchCard` with a map image) is as tall as its image needs.
- *Drift:* the half-steps between neighbours at the same level (`px-4 py-2.5` / `px-4 py-3` / `px-3.5
  py-2` for in-card lists; `px-5 py-3` / `px-5 py-4` for page lists).

The standard for a list row is two densities, with the divider, `lift-row` and last-row rules as above:
**regular** (`px-5 py-4`, page-level lists with two-line content) and **compact** (`px-4 py-2.5`, in-card
and single-line lists). A list adopts one of them rather than choosing its own padding. The rows that
keep their own spacing:
- Image-backed rows and cards (`MatchCard` with a map image, the hero season rows at `px-6 py-5`): their
  height follows the image.
- `MatchManager`'s rows and its expanded panel: an admin surface whose `grid` columns and expansion are
  its own layout.
- H2H rows whose `grid-cols` template sets the columns: they take the compact horizontal padding but keep
  their column template.

A shared row component is not part of the standard: the rows differ in element (`Link`, `button`, `div`),
in grid template and in click behavior, so the only code they have in common is a class string, and the
standard is the two densities above applied to that string.

**Empty states.** Use the shared **`EmptyState`** (`src/components/EmptyState.tsx`,
`size="sm"|"lg"`) for a "nothing here" message — `sm` for an inline one-liner inside an existing
layout, `lg` for a standalone bordered/centered block. Don't hand-roll the class string per call
site. A **loading** placeholder is a different thing than an empty state (there's data coming, there
just isn't any *yet* to show) — keep those as their own inline markup even if the visual styling
happens to look similar; forcing a loading message through `EmptyState` mislabels what's happening.

## Modals

Use the shared **`Modal`** (`src/components/Modal.tsx`) for any full-viewport overlay dialog — it
owns the fixed backdrop, centering, portal-to-`document.body`, and backdrop-click-to-dismiss wiring.
Pass `panelClassName` for the panel's own styling (this varies per use and stays the caller's
markup) and `overlayClassName` only when the backdrop itself needs a non-default color/blur
treatment — that's a parameter of the existing primitive, not a reason to fork it. Omit `onClose` for
a dialog that must be dismissed via an explicit button rather than a backdrop click (e.g. a
destructive confirm).

## Console & admin-surface shapes

Data-heavy operational pages (admin dashboards, ops consoles) recur enough to have their own shape
conventions, distinct from the content-page patterns above:

- **Shape the page around the subject, not the tool.** When a console surfaces the same underlying
  data from multiple angles — a live status feed vs. a searchable management surface — split at that
  seam, not at "which table does this come from." A live feed and a management surface interact
  rarely enough that switching between them costs nothing (no page navigation), but rendering both at
  once usually just produces two things fighting for width.
- **Master-detail for "browse many, act on one."** A picker or search box on one side and the
  selected subject's card (status + actions) on the other is one shape, reused for every subject
  type it applies to — a match picker, a player search, a season list are the same interaction and
  should share one layout rather than each getting its own bordered panel repeating the same chrome.
- **A shared singleton resource gets its own standalone, always-visible panel** — not a row in an
  activity feed, not an entry in a subject picker. The kind of resource one physical thing serves
  many matches (the shared DatHost match server is the current example) isn't "an event that
  happened" or "a thing you search for," so it shouldn't be gated behind a tab or a query.
- **Prefer a tag over a tab for a status split that sits alongside other filters.** When a list already
  narrows by other criteria (type, time range, search), give status (e.g. Errored / In Progress /
  Completed) the same treatment — a badge on each row plus a toggleable filter chip, all filters
  combining on one list — rather than a tab bar that partitions the view. A tab hides whichever tiers
  aren't selected from every other filter at once; a chip lets "Errored jobs from the last hour" and
  "everything from the last hour" both stay one click away. The admin console's Activity feed
  (`AdminActivityFeed.tsx`) is the worked example — status, job type, and time range are three chip rows
  over one list, not three separate axes of tabs.
- **When consolidating several surfaces into one page, actively remove what becomes duplicate.**
  Don't just concatenate sections. If a fact one surface shows is now equally visible somewhere else
  on the same page (a job's error state, a shared resource's current occupant), cut it from the
  second location instead of rendering it twice — keep only what's genuinely unique to that spot.
  The exception is a fact that's also the *reason* you're looking at this surface right now (an ops
  error that explains why a season needs attention, shown again next to its fix) — that's not
  redundant ink, it's the "why" sitting next to the "what to do about it."
- **Group by what a section of controls does, not by which old page it used to live on.** When
  folding several previously-separate surfaces together, the goal is gathering genuinely related
  functionality, not preserving each surface's old boundaries under one roof — re-derive the grouping
  from what the controls actually do (a status readout and everything that reacts to it; every
  control that asserts or compares server-level config), even if that cuts across where things used
  to be split.
- **Collapse sections that are used less often than their neighbors** with the shared
  **`CollapsiblePanel`** (`src/components/CollapsiblePanel.tsx`) rather than hand-rolled
  `<details>`/`<summary>` markup — it gives the ▸/▾ rotation (the same glyph `MatchManager`'s row
  toggle already uses, driven by Tailwind's `group-open:` on the native `open` state, no JS) and a
  `preview` slot for a live status summary that stays visible while collapsed, so a problem inside
  still reads at a glance without expanding.
- **A primary admin action button** uses the shared `ADMIN_PRIMARY_BUTTON_CLS`, and a secondary
  action (an Edit or Manage button, a row action) the bordered `ADMIN_SMALL_BUTTON_CLS`. Both live in
  `src/components/adminButtonStyles.ts` (a plain module, so server components can import the strings;
  a constant exported from a `'use client'` file is a client reference there) — use them rather than a
  re-typed class string per form, appending any call-site-specific modifier (`disabled:opacity-40`,
  `self-start`) on top rather than forking the base style.
- **A failed action's error line** is `<ErrorText error={error} />` (`src/components/ErrorText.tsx`),
  which renders nothing when `error` is empty. `as` swaps the element (`div`, `span`, `p`), `size`
  picks 10/11/12px, and `className` carries spacing or wrapping (`mt-2`, `break-words`) — use it
  rather than a re-typed red line. An array of messages renders one line each (validation lists).
  `tone="onDark"` is the lighter `text-red-300` in the surrounding font, for the dark match panels
  (`MatchServerPanel`, `MatchDemoReviewBlock`) where `--color-accent-red-fg` is too dim. A state
  label that happens to be red (`Server failed to start.`, the force-reset warning) is not an error
  line and stays hand-written.

## When extending this system

If you need a new hover/glow/accent treatment, ask first whether it's really a new *shape* (card vs.
row vs. image-card) or just a new *color* — the latter is almost always a `--lift-accent` override,
not a new class. New semantic colors should become theme tokens (`--color-accent-*`), not inline
hex values, so both themes stay correct automatically.

## Dev-gate pattern

Use the `<DevGate>` component (`src/components/DevGate.tsx`) to hide under-construction UI from
production. It reads `NODE_ENV` itself — no props needed — and renders a dashed amber border with
a small "DEV" badge in the corner so the section is obviously un-shipped in local dev.

```tsx
import DevGate from '@/components/DevGate';

<DevGate className="mt-6">
  {/* your under-construction UI */}
</DevGate>
```

The `className` prop is forwarded to the wrapper `div` for spacing overrides (e.g. `mt-6`, `mt-10`).

**To launch a dev-gated section:** delete the `<DevGate>` wrapper and keep its children.
That's the entire checklist — no other changes needed.

Never use `.dev-gate` directly on production-visible content; always go through `<DevGate>` so the
env check is inseparable from the visual indicator.
