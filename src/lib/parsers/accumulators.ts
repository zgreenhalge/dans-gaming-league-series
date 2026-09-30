import { parseTicks } from '@laihoe/demoparser2';
import type { SabFields } from '../types';
import type { MatchContext } from './matchContext';

type CollectorOut = Map<string, Partial<SabFields>>;

const NS = 'CCSPlayerController.CCSPlayerController_ActionTrackingServices';

// m_iKills/m_iDeaths/m_iAssists/m_iHeadShotKills aren't read here — kills_ct/_t, deaths_ct/_t,
// assists_ct/_t, and headshot_kills_ct/_t are all derived at query time instead
// (deriveSideSplitCounts() in queries/kills.ts, #488). damage_ct/_t isn't read here either: the
// engine's per-round damage netprop (m_flTotalRoundDamageDealt) also counts damage to breakable
// props, which produce no `player_hurt` event and expose no per-hit amount to subtract back out,
// so it is derived from the `match_damage_events` fact rows instead (collectDamageBySide() in
// weaponStats.ts).
// m_iEnemiesFlashed is not read here: enemies_flashed is derived at query time from
// match_utility_throws (queries/utility.ts's deriveUtilityCounts(), #489), which applies the
// half-blind (1.1s) threshold the engine's ungated netprop doesn't.
export const UNSPLIT_PROPS = ['m_iUtilityDamage'] as const;

export const UNSPLIT_FIELDS: Record<string, keyof SabFields> = {
  m_iUtilityDamage: 'utility_damage',
};

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
  const out: CollectorOut = new Map();
  if (context.rounds.length === 0) return out;

  const lastSettleTick = context.settleTicks[context.settleTicks.length - 1];
  const rows: Record<string, unknown>[] = parseTicks(
    demoBuffer,
    UNSPLIT_PROPS.map((p) => `${NS}.${p}`),
    [lastSettleTick],
  );

  const steamSet = new Set(steamIds);
  for (const sid of steamIds) out.set(sid, {});

  for (const row of rows) {
    const sid = String(row.steamid ?? '');
    if (!sid || sid === '0' || !steamSet.has(sid)) continue;
    const partial = out.get(sid)!;
    for (const prop of UNSPLIT_PROPS) {
      partial[UNSPLIT_FIELDS[prop]] = (row[`${NS}.${prop}`] as number) ?? 0;
    }
  }

  return out;
}
