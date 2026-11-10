// Pick/ban completion check and veto window, shared by the match page (rendering) and the veto route
// (which uses the completion check to detect the incomplete→complete transition that fires server
// provisioning, and the window to refuse a non-admin's step before it opens).
//
// Gauntlet = playoffs, so the season's `is_gauntlet` is all this needs to pick the veto shape — see
// docs/glossary.md's Gauntlet entry.

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

/** How long before a match's scheduled time its players can start the pick/ban. An admin can at any time. */
export const VETO_WINDOW_LEAD_MS = 10 * 60 * 1000;

/** The instant, in epoch ms, the veto window opens for a match scheduled at `scheduledAt`. */
export function vetoWindowOpensAt(scheduledAt: string): number {
  return Date.parse(scheduledAt) - VETO_WINDOW_LEAD_MS;
}

/** Whether a match's players can work its pick/ban at `now` (epoch ms): it has a scheduled time and
 *  `vetoWindowOpensAt()` has passed. */
export function isVetoWindowOpen(scheduledAt: string | null, now: number): boolean {
  return scheduledAt != null && now >= vetoWindowOpensAt(scheduledAt);
}

/**
 * Whether a match can be played and scored: a league match once its pick/ban is resolved
 * (`isVetoComplete()`), a scrim match — which has no pick/ban — once its lobby has set the map
 * (`shirts_pick`).
 */
export function isReadyToPlay(m: VetoFields & { scrim_night_id: number | null }, isGauntlet: boolean): boolean {
  return m.scrim_night_id != null ? !!m.shirts_pick : isVetoComplete(m, isGauntlet);
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
