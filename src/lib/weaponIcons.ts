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
 * Pure lookup, no React — shared by the DOM `WeaponIcon` component
 * (`src/components/icons/WeaponIcon.tsx`) and the 2D Replay canvas's kill feed/bomb marker
 * (`src/lib/replay/draw.ts`), which can't depend on `src/components/*`.
 */
const WEAPON_ICON_SRC: Record<string, string> = {
  glock: '/weapon-icons/glock.svg',
  usp_silencer: '/weapon-icons/usp_silencer.svg',
  hkp2000: '/weapon-icons/hkp2000.svg',
  p250: '/weapon-icons/p250.svg',
  fiveseven: '/weapon-icons/fiveseven.svg',
  cz75a: '/weapon-icons/cz75a.svg',
  deagle: '/weapon-icons/deagle.svg',
  revolver: '/weapon-icons/revolver.svg',
  elite: '/weapon-icons/elite.svg',
  tec9: '/weapon-icons/tec9.svg',
  mac10: '/weapon-icons/mac10.svg',
  mp9: '/weapon-icons/mp9.svg',
  mp7: '/weapon-icons/mp7.svg',
  mp5sd: '/weapon-icons/mp5sd.svg',
  ump45: '/weapon-icons/ump45.svg',
  p90: '/weapon-icons/p90.svg',
  bizon: '/weapon-icons/bizon.svg',
  ak47: '/weapon-icons/ak47.svg',
  m4a1: '/weapon-icons/m4a1.svg',
  m4a1_silencer: '/weapon-icons/m4a1_silencer.svg',
  famas: '/weapon-icons/famas.svg',
  galilar: '/weapon-icons/galilar.svg',
  sg556: '/weapon-icons/sg556.svg',
  aug: '/weapon-icons/aug.svg',
  awp: '/weapon-icons/awp.svg',
  ssg08: '/weapon-icons/ssg08.svg',
  scar20: '/weapon-icons/scar20.svg',
  g3sg1: '/weapon-icons/g3sg1.svg',
  mag7: '/weapon-icons/mag7.svg',
  nova: '/weapon-icons/nova.svg',
  sawedoff: '/weapon-icons/sawedoff.svg',
  xm1014: '/weapon-icons/xm1014.svg',
  knife: '/weapon-icons/knife.svg',
  taser: '/weapon-icons/taser.svg',
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
  const stripped = weapon.replace(/^weapon_/, '').toLowerCase();
  if (WEAPON_ICON_SRC[stripped]) return WEAPON_ICON_SRC[stripped];
  if (/knife|bayonet/.test(stripped)) return WEAPON_ICON_SRC.knife;
  return null;
}
