// Pick/ban completion check. Mirrors the inline logic in the match page; shared so the veto route can
// detect the incomplete→complete transition that fires server provisioning.

export interface VetoFields {
  shirts_ban: string | null;
  shirts_ban2: string | null;
  skins_ban1: string | null;
  skins_ban2: string | null;
  shirts_pick: string | null;
  skins_starting_side: string | null;
}

/**
 * Whether the pick/ban is fully resolved. Gauntlet/playoff need the 4 bans (the final map is
 * auto-picked); regular matches also need the pick and the starting side.
 */
export function isVetoComplete(m: VetoFields, isGauntletOrPlayoff: boolean): boolean {
  return isGauntletOrPlayoff
    ? !!(m.shirts_ban && m.shirts_ban2 && m.skins_ban1 && m.skins_ban2)
    : !!(m.shirts_ban && m.skins_ban1 && m.skins_ban2 && m.shirts_pick && m.skins_starting_side);
}
