import { parseTicks } from '@laihoe/demoparser2';
import type { SabFields } from '../types';
import type { MatchContext } from './matchContext';
import { initCollector } from './_shared';

type CollectorOut = Map<string, Partial<SabFields>>;

const NS = 'CCSPlayerController.CCSPlayerController_ActionTrackingServices';

// Only `m_iUtilityDamage` is read from the demo's accumulators. Everything else that looks like an
// engine counter is derived elsewhere: kills/deaths/assists/headshot splits at query time from
// `match_kills` (deriveSideSplitCounts() in queries/kills.ts); `enemies_flashed` from
// `match_utility_throws` (queries/utility.ts's deriveUtilityCounts()), which applies the half-blind
// (1.1s) threshold the engine's ungated netprop doesn't; and `damage_ct`/`damage_t` from the
// `match_damage_events` rows (collectDamageBySide() in weaponStats.ts), because the engine's
// per-round damage netprop (m_flTotalRoundDamageDealt) also counts damage to breakable props, which
// produce no `player_hurt` event and expose no per-hit amount to subtract back out.
const UTILITY_DAMAGE_PROP = `${NS}.m_iUtilityDamage`;

/**
 * Match-cumulative engine accumulators. `m_iUtilityDamage` is read once, at the last round's
 * settle tick (see `computeSettleTicks()` in `matchContext.ts`) — after the match's final trailing
 * action, and a tick that is guaranteed to exist in the recording.
 */
export function collectAccumulators(
  demoBuffer: Buffer,
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const { out, steamSet } = initCollector<SabFields>(steamIds);
  if (context.rounds.length === 0) return new Map();

  const lastSettleTick = context.settleTicks[context.settleTicks.length - 1];
  const rows = parseTicks(demoBuffer, [UTILITY_DAMAGE_PROP], [lastSettleTick]) as Record<string, unknown>[];

  for (const row of rows) {
    const sid = String(row.steamid ?? '');
    if (!sid || sid === '0' || !steamSet.has(sid)) continue;
    out.get(sid)!.utility_damage = (row[UTILITY_DAMAGE_PROP] as number) ?? 0;
  }

  return out;
}
