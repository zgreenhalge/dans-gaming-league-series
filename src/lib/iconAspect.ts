/**
 * Width-to-height ratio for every non-square icon asset under `public/{weapon,grenade}-icons/`.
 * Everything that renders one of these — `MaskedIcon` (DOM, via CSS `mask-size: contain`) and the
 * 2D Replay canvas's `getIconSprite()` sprites — sizes an icon to a single target height, and a
 * caller that assumes a square box either letterboxes a landscape icon down (CSS mask) or squashes
 * it (a fixed canvas box) instead of rendering it at its real, legible shape. CS2's weapon icons in
 * particular are far from square (a rifle like the AWP is 109.5x32); grenade icons vary too (HE,
 * molotov, and smoke are each a different width at a near-32px height).
 *
 * Values are copied from each SVG's own `viewBox` width/height, not estimated — the same numbers
 * `scripts/sync-icons.ts` bakes into each file's `width`/`height` attributes when it pulls an icon
 * from upstream. Re-check this table against the file's `viewBox` if a sync ever changes one (the
 * 2D Replay canvas doesn't need this: `getIconSprite()` reads the loaded bitmap's own natural size
 * instead of a lookup, so it can't go stale). Round (`bomb`, `defuse`, `clock`, `skull`), side
 * (`ct`, `t`), and kill-modifier (`headshot`) icons are all square and omitted — `iconAspect()`
 * defaults to 1 for anything not listed here.
 */
const ICON_ASPECT: Record<string, number> = {
  '/weapon-icons/glock.svg': 44.875 / 32,
  '/weapon-icons/usp_silencer.svg': 69.25 / 32,
  '/weapon-icons/hkp2000.svg': 32.167 / 32,
  '/weapon-icons/p250.svg': 37.75 / 32,
  '/weapon-icons/fiveseven.svg': 39 / 32,
  '/weapon-icons/cz75a.svg': 47.875 / 32,
  '/weapon-icons/deagle.svg': 50.75 / 32,
  '/weapon-icons/revolver.svg': 52.5 / 32,
  '/weapon-icons/elite.svg': 68.25 / 32,
  '/weapon-icons/tec9.svg': 52.375 / 32,
  '/weapon-icons/mac10.svg': 44.625 / 32,
  '/weapon-icons/mp9.svg': 73.625 / 32,
  '/weapon-icons/mp7.svg': 49.125 / 32,
  '/weapon-icons/mp5sd.svg': 92.592 / 39.134,
  '/weapon-icons/ump45.svg': 83.5 / 32,
  '/weapon-icons/p90.svg': 68.375 / 32,
  '/weapon-icons/bizon.svg': 90 / 32,
  '/weapon-icons/ak47.svg': 88.5 / 32,
  '/weapon-icons/m4a1.svg': 78.604 / 32,
  '/weapon-icons/m4a1_silencer.svg': 96.5 / 32,
  '/weapon-icons/famas.svg': 77.833 / 32,
  '/weapon-icons/galilar.svg': 90.25 / 32,
  '/weapon-icons/sg556.svg': 89.667 / 32,
  '/weapon-icons/aug.svg': 75.833 / 32,
  '/weapon-icons/awp.svg': 109.5 / 32,
  '/weapon-icons/ssg08.svg': 99.75 / 32,
  '/weapon-icons/scar20.svg': 98 / 32,
  '/weapon-icons/g3sg1.svg': 93.25 / 32,
  '/weapon-icons/mag7.svg': 67.5 / 32,
  '/weapon-icons/nova.svg': 100.25 / 32,
  '/weapon-icons/sawedoff.svg': 84.75 / 32,
  '/weapon-icons/xm1014.svg': 97.875 / 32,
  '/weapon-icons/knife.svg': 76.833 / 32,
  '/weapon-icons/taser.svg': 41.5 / 32,
  '/grenade-icons/he.svg': 25 / 33,
  '/grenade-icons/molotov.svg': 22 / 32,
  '/grenade-icons/smoke.svg': 15 / 32,
};

/** The icon's width-to-height ratio, so a caller sizing by a fixed height (or width) can derive
 *  the other dimension and fit the icon without distorting or letterboxing it. Defaults to 1
 *  (square) for `null`/unlisted paths. */
export function iconAspect(src: string | null | undefined): number {
  if (!src) return 1;
  return ICON_ASPECT[src] ?? 1;
}
