import { iconAspect } from './iconAspect';
import { WEAPON_CATEGORY, stripWeaponPrefix } from './parsers/weaponClasses';

/**
 * Weapon icon lookup, sourced from CS2's own buy-menu equipment icons (via
 * https://github.com/Juknum/counter-strike-icons) — the full Wingman gun roster from
 * `WEAPON_CATEGORY` (`src/lib/parsers/weaponClasses.ts`) plus a generic knife for every
 * melee-kill classname (bayonet, knife skins, ...) and the Zeus x27. Every gun's icon path is
 * derived from its `WEAPON_CATEGORY` key the same way `scripts/sync-icons.ts`'s `WEAPON_ENTRIES`
 * derives the upstream fetch list, so a weapon added there gets an icon entry here for free.
 * Grenade kills reuse the icons already sourced for the replay pen tool
 * (`public/grenade-icons/`) rather than duplicating them — `hegrenade` for HE kills,
 * `molotov`/`incgrenade`/`inferno`/`incendiary`/`fire` for fire-tick kills. The game reports every
 * fire-tick death as `inferno` regardless of which nade caused it; `killWeaponLabel()`
 * (`src/lib/replay/draw.ts`) recovers the molotov-vs-incendiary distinction by correlating to the
 * attacker's own grenade throws, resolving to `molotov` or `incendiary` — both (and its own `fire`
 * fallback) map to the same icon here, since visually distinguishing the two isn't worth a second
 * icon.
 *
 * Pure lookup, no React — shared by the DOM `WeaponIcon` component
 * (`src/components/icons/WeaponIcon.tsx`) and the 2D Replay canvas's kill feed/bomb marker
 * (`src/lib/replay/draw.ts`), which can't depend on `src/components/*`. Aspect ratios (each
 * icon's real, non-square shape) live in `src/lib/iconAspect.ts`, keyed by the same src path, so
 * any renderer of any icon in the repo — not just weapons — shares one source of truth for them.
 */
const WEAPON_ICON_SRC: Record<string, string> = {
  ...Object.fromEntries(
    [...Object.keys(WEAPON_CATEGORY), 'knife', 'taser'].map((name) => [name, `/weapon-icons/${name}.svg`]),
  ),
  hegrenade: '/grenade-icons/he.svg',
  molotov: '/grenade-icons/molotov.svg',
  incgrenade: '/grenade-icons/molotov.svg',
  inferno: '/grenade-icons/molotov.svg',
  incendiary: '/grenade-icons/molotov.svg',
  fire: '/grenade-icons/molotov.svg',
};

/** Resolves a raw kill/fire weapon classname (prefixed or not, e.g. `weapon_ak47` or `ak47`) to
 *  an icon source path, falling back to the generic knife for any bayonet/knife-skin variant CS2
 *  reports (there isn't one fixed classname). Returns `null` for anything with no icon (world,
 *  unrecognized/legacy weapons) so callers can render nothing rather than a broken image. */
export function weaponIconSrc(weapon: string | null | undefined): string | null {
  if (!weapon) return null;
  const stripped = stripWeaponPrefix(weapon).toLowerCase();
  if (WEAPON_ICON_SRC[stripped]) return WEAPON_ICON_SRC[stripped];
  if (/knife|bayonet/.test(stripped)) return WEAPON_ICON_SRC.knife;
  return null;
}

/** The resolved icon's width-to-height ratio — see `iconAspect()` in `src/lib/iconAspect.ts`. */
export function weaponIconAspect(weapon: string | null | undefined): number {
  return iconAspect(weaponIconSrc(weapon));
}
