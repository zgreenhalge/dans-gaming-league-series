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
