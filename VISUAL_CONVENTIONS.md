# Visual Conventions ("Broadcast Chrome")

The site's visual language — a CS2-broadcast-inspired theme with a light "Dust2 daylight" mode and
a dark "broadcast HUD" mode. This doc names the shared utilities in `src/app/globals.css` so the
visual-refresh pass (commits `2d1ed97`, `c3b9415`, `8a97368`) stays a *system* instead of drifting
into one-off classes per component. **Reach for these before writing new hover/glow/accent CSS.**

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
bottom rule. Don't hand-roll a `flex justify-between` tab row; it won't wrap.

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
