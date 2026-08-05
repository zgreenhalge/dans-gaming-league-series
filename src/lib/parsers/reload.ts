import type { SabFields } from '../types';
import type { MatchContext } from './matchContext';
import { initCollector, roundOf } from './_shared';

type CollectorOut = Map<string, Partial<SabFields>>;

export interface WeaponReloadRow {
  tick: number;
  total_rounds_played: number;
  user_steamid: string | null;
}

export interface PlayerReloadStateRow {
  tick: number;
  steamid: string;
  inReload: boolean;
  clip1: number;
}

/** Tick list demoOrchestrator.ts needs to fetch (via parseTicks, all players): one per
 *  weapon_reload event, in a live round. */
export function neededReloadTicks(reloadEvents: WeaponReloadRow[], liveRounds: Set<number>): number[] {
  const ticks = new Set<number>();
  for (const r of reloadEvents) {
    if (roundOf(r, liveRounds) == null) continue;
    ticks.add(r.tick);
  }
  return [...ticks];
}

/**
 * Rounds dropped on reload (#212): bullets still in the magazine — and therefore wasted — when a
 * player reloads before it's empty. `weapon_reload` is a discrete game event (confirmed against a
 * real DGLS demo, despite CS2's demo stream generally lacking one for most actions), so this reads
 * `Weapon.m_iClip1`/`Weapon.m_bInReload` at each event's own tick rather than periodic sampling —
 * the old clip's ammo count is frozen for the whole reload window (can't fire mid-reload), so the
 * event tick itself always lands inside it.
 */
export function collectRoundsDropped(
  reloadEvents: WeaponReloadRow[],
  tickRows: PlayerReloadStateRow[],
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const { out, steamSet } = initCollector<SabFields>(steamIds);

  const rowLookup = new Map<string, PlayerReloadStateRow>();
  for (const r of tickRows) rowLookup.set(`${r.steamid}::${r.tick}`, r);

  for (const reload of reloadEvents) {
    if (roundOf(reload, context.liveRounds) == null) continue;
    const shooter = reload.user_steamid;
    if (!shooter || !steamSet.has(shooter)) continue;

    const state = rowLookup.get(`${shooter}::${reload.tick}`);
    if (!state || !state.inReload) continue; // can't confirm the dropped count without a matching in-reload read

    const p = out.get(shooter)!;
    p.reloads_total = ((p.reloads_total as number) ?? 0) + 1;
    if (state.clip1 > 0) {
      p.rounds_dropped_on_reload_total = ((p.rounds_dropped_on_reload_total as number) ?? 0) + state.clip1;
    }
  }

  return out;
}
