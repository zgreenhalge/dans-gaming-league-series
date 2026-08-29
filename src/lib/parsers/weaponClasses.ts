/**
 * Weapon class lookup for #279's per-category stats, keyed by demoparser2's unprefixed weapon
 * name (the same short form `player_hurt`'s `weapon` field already reports). `weapon_fire`'s
 * `weapon` field carries the `weapon_` prefix, so callers strip it via `stripWeaponPrefix()`
 * before looking a fire event up here.
 *
 * This is also the single source of truth for "is this weapon a gun" used by accuracy.ts to
 * decide whether a fire/hurt event counts toward Shots Fired/Hit — as an allowlist, anything not
 * in the roster (knife skins, grenades, C4) falls through automatically with no exclusion list to
 * maintain.
 *
 * Covers the full CS2 gun roster, not just weapons seen in a single Wingman demo — a league can
 * change its restricted buy list without this map needing to change.
 */
export type WeaponCategory = 'pistol' | 'smg' | 'rifle' | 'sniper' | 'shotgun';

export const WEAPON_CATEGORY: Record<string, WeaponCategory> = {
  // Pistols
  glock: 'pistol', usp_silencer: 'pistol', hkp2000: 'pistol', p250: 'pistol',
  fiveseven: 'pistol', cz75a: 'pistol', deagle: 'pistol', revolver: 'pistol',
  elite: 'pistol', tec9: 'pistol',
  // SMGs
  mac10: 'smg', mp9: 'smg', mp7: 'smg', mp5sd: 'smg', ump45: 'smg', p90: 'smg', bizon: 'smg',
  // Rifles
  ak47: 'rifle', m4a1: 'rifle', m4a1_silencer: 'rifle', famas: 'rifle',
  galilar: 'rifle', sg556: 'rifle', aug: 'rifle',
  // Snipers (bolt-action and auto)
  awp: 'sniper', ssg08: 'sniper', scar20: 'sniper', g3sg1: 'sniper',
  // Shotguns
  mag7: 'shotgun', nova: 'shotgun', sawedoff: 'shotgun', xm1014: 'shotgun',
};

/** `weapon_fire`'s classname ('weapon_ak47') to the unprefixed form WEAPON_CATEGORY is keyed by. */
export function stripWeaponPrefix(classname: string): string {
  return classname.startsWith('weapon_') ? classname.slice('weapon_'.length) : classname;
}

/** The gun-only categories `player_match_weapon_stats`/`getAllWeaponClassStats()` bucket shot/
 *  accuracy/damage/rounds breakdowns into (#279) — a fixed, ordered subset of `KillWeaponCategory`
 *  covering guns alone, since that breakdown has no melee/utility/other rows to display. */
export const WEAPON_CATEGORIES: WeaponCategory[] = ['pistol', 'smg', 'rifle', 'sniper', 'shotgun'];

/** Whether `weapon` is one CS2 tracks shots-fired/accuracy for at all — i.e. it has a
 *  `WEAPON_CATEGORY` entry (#474). A knife, grenade, taser, or bomb has no such concept; a gun a
 *  player simply hasn't fired in scope is a real *zero*, which is a different thing entirely
 *  (`resolveWeaponFilterStat()`, `kills.ts`, treats the two distinctly). */
export function isGunWeapon(weapon: string): boolean {
  return WEAPON_CATEGORY[stripWeaponPrefix(weapon).toLowerCase()] != null;
}

/**
 * Category bucket for a *kill* weapon — every `player_death.weapon` value resolves to one of
 * these, unlike `WEAPON_CATEGORY` (guns only, deliberately left as an allowlist for
 * `accuracy.ts`'s shots-fired/hit gating). Reuses `WEAPON_CATEGORY` for guns rather than
 * duplicating that roster, and substring-matches non-gun kill weapons the same way
 * `replay/extract.ts`'s `isBulletWeapon()` already does — CS2 reports several knife-skin
 * classnames (e.g. `bayonet`, `knife_karambit`), not one fixed string, so an allowlist would
 * miss variants.
 */
export type KillWeaponCategory = WeaponCategory | 'melee' | 'utility' | 'other';

export function killWeaponCategory(weapon: string): KillWeaponCategory {
  const stripped = stripWeaponPrefix(weapon).toLowerCase();
  const gunCategory = WEAPON_CATEGORY[stripped];
  if (gunCategory) return gunCategory;
  if (/knife|bayonet/.test(stripped)) return 'melee';
  if (/grenade|molotov|incgren|inferno|taser/.test(stripped)) return 'utility';
  return 'other';
}

/** Every `KillWeaponCategory`, in the order the Weapons sub-tab's category filter lists them
 *  (#474) — guns from closest-range to longest, then melee, utility, and the catch-all last. */
export const KILL_WEAPON_CATEGORIES: KillWeaponCategory[] = [
  'pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'melee', 'utility', 'other',
];

/** Display label for a kill-weapon category — the category filter's option text and the Weapons
 *  sub-tab's column/tile title when a whole category is selected rather than one weapon (#474). */
export const KILL_WEAPON_CATEGORY_LABEL: Record<KillWeaponCategory, string> = {
  pistol: 'Pistols', smg: 'SMGs', rifle: 'Rifles', sniper: 'Snipers', shotgun: 'Shotguns',
  melee: 'Knives', utility: 'Utility', other: 'Other',
};

/** Canonical identity a kill weapon groups under — every knife/bayonet skin variant CS2 reports
 *  (`bayonet`, `knife_karambit`, `knife_m9_bayonet`, …) collapses to the single `knife` key so
 *  kills-by-weapon breakdowns (`aggregateWeaponKillStats()`, the Weapons sub-tab's per-weapon
 *  filter) show one combined "Knife" row instead of splitting an equivalent kill across a dozen
 *  cosmetically-different skin names (#474). Every other weapon keeps its own stripped, lowercased
 *  classname as its own key. Defers to `killWeaponCategory()`'s own `melee` detection rather than
 *  re-matching the knife/bayonet pattern here, so the variant list has one source of truth. */
export function weaponGroupKey(weapon: string): string {
  const stripped = stripWeaponPrefix(weapon).toLowerCase();
  return killWeaponCategory(weapon) === 'melee' ? 'knife' : stripped;
}

/** Display name for a weapon's grouped identity (`weaponGroupKey()`) — the CS2 buy-menu name
 *  players expect (`AK-47`, `USP-S`, `Desert Eagle`, …) instead of the raw backend classname
 *  `match_kills.weapon` stores (#474). Anything not in the roster (a legacy/unrecognized weapon)
 *  falls back to a title-cased version of its own key rather than hiding it. */
const WEAPON_DISPLAY_NAME: Record<string, string> = {
  // Pistols
  glock: 'Glock-18', usp_silencer: 'USP-S', hkp2000: 'P2000', p250: 'P250',
  fiveseven: 'Five-SeveN', cz75a: 'CZ75-Auto', deagle: 'Desert Eagle', revolver: 'R8 Revolver',
  elite: 'Dual Berettas', tec9: 'Tec-9',
  // SMGs
  mac10: 'MAC-10', mp9: 'MP9', mp7: 'MP7', mp5sd: 'MP5-SD', ump45: 'UMP-45', p90: 'P90', bizon: 'PP-Bizon',
  // Rifles
  ak47: 'AK-47', m4a1: 'M4A4', m4a1_silencer: 'M4A1-S', famas: 'FAMAS',
  galilar: 'Galil AR', sg556: 'SG 553', aug: 'AUG',
  // Snipers
  awp: 'AWP', ssg08: 'SSG 08', scar20: 'SCAR-20', g3sg1: 'G3SG1',
  // Shotguns
  mag7: 'MAG-7', nova: 'Nova', sawedoff: 'Sawed-Off', xm1014: 'XM1014',
  // Melee / utility / other kill weapons
  knife: 'Knife', taser: 'Zeus x27', hegrenade: 'HE Grenade', flashbang: 'Flashbang',
  smokegrenade: 'Smoke Grenade', decoy: 'Decoy Grenade', molotov: 'Molotov',
  incgrenade: 'Incendiary Grenade', inferno: 'Fire', world: 'World', planted_c4: 'C4',
};

function titleCaseFallback(key: string): string {
  return key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function weaponDisplayName(weapon: string): string {
  const key = weaponGroupKey(weapon);
  return WEAPON_DISPLAY_NAME[key] ?? titleCaseFallback(key);
}
