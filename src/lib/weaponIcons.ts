/**
 * Weapon icon lookup, sourced from CS2's own buy-menu equipment icons (via
 * https://github.com/Juknum/counter-strike-icons) — the full Wingman gun roster from
 * `WEAPON_CATEGORY` (`src/lib/parsers/weaponClasses.ts`) plus a generic knife for every
 * melee-kill classname (bayonet, knife skins, ...) and the Zeus x27. Grenade kills reuse the
 * icons already sourced for the replay pen tool (`public/grenade-icons/`) rather than duplicating
 * them — `hegrenade` for HE kills, `molotov`/`incgrenade`/`inferno`/`incendiary`/`fire` for
 * fire-tick kills. The game reports every fire-tick death as `inferno` regardless of which nade
 * caused it; `killWeaponLabel()` (`src/lib/replay/draw.ts`) recovers the molotov-vs-incendiary
 * distinction by correlating to the attacker's own grenade throws, resolving to `molotov` or
 * `incendiary` — both (and its own `fire` fallback) map to the same icon here, since visually
 * distinguishing the two isn't worth a second icon.
 *
 * Each entry also carries the source SVG's own `viewBox` width/height. Every icon in
 * `public/weapon-icons/` and `public/grenade-icons/` is a landscape (or near-square) silhouette at
 * a fixed source height with varying width — `scripts/sync-icons.ts` bakes the real `viewBox` into
 * each file's `width`/`height` attributes on every re-sync, and the values here are copied from
 * that same source of truth, not estimated — so `weaponIconAspect()` lets callers fit an icon to a
 * target height without squashing it into a square box.
 *
 * Pure lookup, no React — shared by the DOM `WeaponIcon` component
 * (`src/components/icons/WeaponIcon.tsx`) and the 2D Replay canvas's kill feed/bomb marker
 * (`src/lib/replay/draw.ts`), which can't depend on `src/components/*`.
 */
interface WeaponIconEntry {
  src: string;
  width: number;
  height: number;
}

const MOLOTOV_ICON: WeaponIconEntry = { src: '/grenade-icons/molotov.svg', width: 22, height: 32 };

const WEAPON_ICON: Record<string, WeaponIconEntry> = {
  glock: { src: '/weapon-icons/glock.svg', width: 44.875, height: 32 },
  usp_silencer: { src: '/weapon-icons/usp_silencer.svg', width: 69.25, height: 32 },
  hkp2000: { src: '/weapon-icons/hkp2000.svg', width: 32.167, height: 32 },
  p250: { src: '/weapon-icons/p250.svg', width: 37.75, height: 32 },
  fiveseven: { src: '/weapon-icons/fiveseven.svg', width: 39, height: 32 },
  cz75a: { src: '/weapon-icons/cz75a.svg', width: 47.875, height: 32 },
  deagle: { src: '/weapon-icons/deagle.svg', width: 50.75, height: 32 },
  revolver: { src: '/weapon-icons/revolver.svg', width: 52.5, height: 32 },
  elite: { src: '/weapon-icons/elite.svg', width: 68.25, height: 32 },
  tec9: { src: '/weapon-icons/tec9.svg', width: 52.375, height: 32 },
  mac10: { src: '/weapon-icons/mac10.svg', width: 44.625, height: 32 },
  mp9: { src: '/weapon-icons/mp9.svg', width: 73.625, height: 32 },
  mp7: { src: '/weapon-icons/mp7.svg', width: 49.125, height: 32 },
  mp5sd: { src: '/weapon-icons/mp5sd.svg', width: 92.592, height: 39.134 },
  ump45: { src: '/weapon-icons/ump45.svg', width: 83.5, height: 32 },
  p90: { src: '/weapon-icons/p90.svg', width: 68.375, height: 32 },
  bizon: { src: '/weapon-icons/bizon.svg', width: 90, height: 32 },
  ak47: { src: '/weapon-icons/ak47.svg', width: 88.5, height: 32 },
  m4a1: { src: '/weapon-icons/m4a1.svg', width: 78.604, height: 32 },
  m4a1_silencer: { src: '/weapon-icons/m4a1_silencer.svg', width: 96.5, height: 32 },
  famas: { src: '/weapon-icons/famas.svg', width: 77.833, height: 32 },
  galilar: { src: '/weapon-icons/galilar.svg', width: 90.25, height: 32 },
  sg556: { src: '/weapon-icons/sg556.svg', width: 89.667, height: 32 },
  aug: { src: '/weapon-icons/aug.svg', width: 75.833, height: 32 },
  awp: { src: '/weapon-icons/awp.svg', width: 109.5, height: 32 },
  ssg08: { src: '/weapon-icons/ssg08.svg', width: 99.75, height: 32 },
  scar20: { src: '/weapon-icons/scar20.svg', width: 98, height: 32 },
  g3sg1: { src: '/weapon-icons/g3sg1.svg', width: 93.25, height: 32 },
  mag7: { src: '/weapon-icons/mag7.svg', width: 67.5, height: 32 },
  nova: { src: '/weapon-icons/nova.svg', width: 100.25, height: 32 },
  sawedoff: { src: '/weapon-icons/sawedoff.svg', width: 84.75, height: 32 },
  xm1014: { src: '/weapon-icons/xm1014.svg', width: 97.875, height: 32 },
  knife: { src: '/weapon-icons/knife.svg', width: 76.833, height: 32 },
  taser: { src: '/weapon-icons/taser.svg', width: 41.5, height: 32 },
  hegrenade: { src: '/grenade-icons/he.svg', width: 25, height: 33 },
  molotov: MOLOTOV_ICON,
  incgrenade: MOLOTOV_ICON,
  inferno: MOLOTOV_ICON,
  incendiary: MOLOTOV_ICON,
  fire: MOLOTOV_ICON,
};

function resolveWeaponIcon(weapon: string | null | undefined): WeaponIconEntry | null {
  if (!weapon) return null;
  const stripped = weapon.replace(/^weapon_/, '').toLowerCase();
  if (WEAPON_ICON[stripped]) return WEAPON_ICON[stripped];
  if (/knife|bayonet/.test(stripped)) return WEAPON_ICON.knife;
  return null;
}

/** Resolves a raw kill/fire weapon classname (prefixed or not, e.g. `weapon_ak47` or `ak47`) to
 *  an icon source path, falling back to the generic knife for any bayonet/knife-skin variant CS2
 *  reports (there isn't one fixed classname). Returns `null` for anything with no icon (world,
 *  unrecognized/legacy weapons) so callers can render nothing rather than a broken image. */
export function weaponIconSrc(weapon: string | null | undefined): string | null {
  return resolveWeaponIcon(weapon)?.src ?? null;
}

/** The icon's width-to-height ratio, so a caller sizing by a fixed height (or width) can derive
 *  the other dimension and fit the icon without distorting or letterboxing it. Defaults to 1
 *  (square) for anything `weaponIconSrc()` wouldn't resolve either. */
export function weaponIconAspect(weapon: string | null | undefined): number {
  const entry = resolveWeaponIcon(weapon);
  return entry ? entry.width / entry.height : 1;
}
