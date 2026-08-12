// Pick/ban completion check, shared by the match page (rendering) and the veto route (which uses it
// to detect the incomplete→complete transition that fires server provisioning).
//
// Gauntlet rounds ARE the playoffs — there is no separate "playoff" format. `is_gauntlet` (season)
// is the single flag that decides which veto shape a match uses; `is_playoff_game` (match) is a
// downstream consequence of it, not an independent input.

export interface VetoFields {
  shirts_ban: string | null;
  shirts_ban2: string | null;
  skins_ban1: string | null;
  skins_ban2: string | null;
  shirts_pick: string | null;
  skins_starting_side: string | null;
}

/**
 * Whether the pick/ban is fully resolved. Gauntlet matches need the 4 bans (the final map is
 * auto-picked); regular matches also need the pick and the starting side.
 */
export function isVetoComplete(m: VetoFields, isGauntlet: boolean): boolean {
  return isGauntlet
    ? !!(m.shirts_ban && m.shirts_ban2 && m.skins_ban1 && m.skins_ban2)
    : !!(m.shirts_ban && m.skins_ban1 && m.skins_ban2 && m.shirts_pick && m.skins_starting_side);
}
