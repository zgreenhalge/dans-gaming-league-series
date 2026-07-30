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
