// Pick/ban completion check, shared by the match page (rendering) and the veto route (which uses it
// to detect the incomplete→complete transition that fires server provisioning).
//
// Gauntlet = playoffs, so a single gauntlet-shaped boolean is all this needs — see docs/glossary.md's
// Gauntlet entry for why callers should pass `isGauntlet || match.is_playoff_game` rather than
// `isGauntlet` alone.

import type { RoundHistoryEntry } from './types';

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

/**
 * The map a match is played on. The two pick columns are mutually exclusive: `shirts_pick` holds the
 * map when SHIRTS picked (and the gauntlet auto-pick, always), `skins_pick` holds it only when SKINS
 * picked in the regular veto flow — so neither alone is "the picked map". See docs/glossary.md's Veto
 * entry.
 */
export function effectivePickedMap(m: { shirts_pick: string | null; skins_pick: string | null }): string | null {
  return m.shirts_pick ?? m.skins_pick;
}

/**
 * The side SKINS started on: the stored `skins_starting_side`, else — for a gauntlet match, whose
 * knife round decides the side so nothing is stored — the one the demo's first recorded round
 * implies (`round_history` is in round order and starts at the live match's round 1). `null` when
 * neither is known.
 */
export function effectiveSkinsStartingSide(m: {
  skins_starting_side: 'CT' | 'T' | null;
  round_history: RoundHistoryEntry[] | null;
}): 'CT' | 'T' | null {
  if (m.skins_starting_side) return m.skins_starting_side;
  const first = m.round_history?.reduce<RoundHistoryEntry | null>((a, r) => (!a || r.n < a.n ? r : a), null);
  if (!first) return null;
  return first.winner === 'SKINS' ? first.side : first.side === 'CT' ? 'T' : 'CT';
}
