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

## Typography

- **`.font-display`** / **`.font-mono`** — the two custom font families
- **`.tracked`** / **`.tracked-wide`** — uppercase, letter-spaced "broadcast label" styling for
  small section headers/eyebrows
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

**Table header cells.** Use the shared **`Th`** (`src/components/Th.tsx`, `align="left"|"right"`)
for a stat table's static (non-sortable) header cells instead of repeating the tracked/bordered class
string per column. A column whose header is itself clickable to sort keeps its own `SortableTh`-style
component — that's a different, interactive shape, not a `Th` variant.

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
- **A primary admin action button** uses the shared `ADMIN_PRIMARY_BUTTON_CLS` (exported from
  `src/components/ArmedConfirmButton.tsx` alongside its `CONFIRM_VARIANT` styles) rather than a
  re-typed class string per form — append any call-site-specific modifier (`disabled:opacity-40`,
  `self-start`) on top rather than forking the base style.

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
