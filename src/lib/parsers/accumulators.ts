import { parseTicks } from '@laihoe/demoparser2';
import type { SabFields } from '../types';
import type { MatchContext } from './matchContext';

type CollectorOut = Map<string, Partial<SabFields>>;

const NS = 'CCSPlayerController.CCSPlayerController_ActionTrackingServices';

// m_iKills/m_iDeaths/m_iAssists/m_iHeadShotKills aren't read here — kills_ct/_t, deaths_ct/_t,
// assists_ct/_t, and headshot_kills_ct/_t are all derived at query time instead
// (deriveSideSplitCounts() in queries/kills.ts, #488). damage_ct/_t stays live-collected: it isn't a
// clean duplicate of any existing fact table (#491).
//
// m_flTotalRoundDamageDealt, not m_iDamage: m_iDamage is a match-cumulative counter, but its value
// at a round's end tick reflects state through the *previous* round, not the round that just ended
// — the engine updates it one round late relative to the round_end event. Delta-computing from it
// (value@roundEnd(R) − value@roundEnd(R−1)) therefore attributes each round's real damage to the
// following round's side, which only reads as correct within a half (adjacent rounds share a side)
// and silently corrupts the CT/T split across every halftime/OT swap boundary — confirmed against a
// real match by comparing m_iDamage's round-by-round delta against m_flTotalRoundDamageDealt's own
// round-by-round raw value (#491). m_flTotalRoundDamageDealt is itself already scoped to the
// current round (it resets rather than accumulating), so reading its raw value at each round's end
// tick needs no delta arithmetic at all.
export const SPLIT_PROPS = ['m_flTotalRoundDamageDealt'] as const;
// m_iEnemiesFlashed is not read here: enemies_flashed is derived at query time from
// match_utility_throws (queries/utility.ts's deriveUtilityCounts(), #489), which applies the
// half-blind (1.1s) threshold the engine's ungated netprop doesn't.
export const UNSPLIT_PROPS = ['m_iUtilityDamage'] as const;

export const SPLIT_FIELDS: Record<string, { ct: keyof SabFields; t: keyof SabFields }> = {
  m_flTotalRoundDamageDealt: { ct: 'damage_ct', t: 'damage_t' },
};

export const UNSPLIT_FIELDS: Record<string, keyof SabFields> = {
  m_iUtilityDamage: 'utility_damage',
};

export function collectAccumulators(
  demoBuffer: Buffer,
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const out: CollectorOut = new Map();
  if (context.roundEndTicks.length === 0) return out;

  const allProps = [
    ...SPLIT_PROPS.map((p) => `${NS}.${p}`),
    ...UNSPLIT_PROPS.map((p) => `${NS}.${p}`),
  ];

  const rows: Record<string, unknown>[] = parseTicks(
    demoBuffer,
    allProps,
    Array.from(context.roundEndTicks),
  );

  const steamSet = new Set(steamIds);

  // Group rows by tick, then by steamid
  const byTickAndSteam = new Map<number, Map<string, Record<string, unknown>>>();
  for (const row of rows) {
    const tick = row.tick as number;
    const sid = String(row.steamid ?? '');
    if (!sid || sid === '0' || !steamSet.has(sid)) continue;
    if (!byTickAndSteam.has(tick)) byTickAndSteam.set(tick, new Map());
    byTickAndSteam.get(tick)!.set(sid, row);
  }

  // Split stats are already scoped to the current round (see SPLIT_PROPS's comment) — each
  // round's own raw value is credited directly, no cross-round delta needed.
  const roundList = context.rounds;

  for (const sid of steamIds) {
    out.set(sid, {});
  }

  for (const round of roundList) {
    const tickMap = byTickAndSteam.get(round.endTick);

    for (const sid of steamIds) {
      const row = tickMap?.get(sid);
      if (!row) {
        if (tickMap) {
          context.warnings.push(
            `No accumulator data for ${sid} at tick ${round.endTick} (round ${round.roundNumber}) — possible disconnect.`,
          );
        }
        continue;
      }

      const side = context.playerSides.get(sid)?.get(round.roundNumber);
      const partial = out.get(sid)!;

      for (const prop of SPLIT_PROPS) {
        const val = Math.round((row[`${NS}.${prop}`] as number) ?? 0);

        if (val !== 0 && side && context.hasSides) {
          const fields = SPLIT_FIELDS[prop];
          const key = side === 'CT' ? fields.ct : fields.t;
          partial[key] = ((partial[key] as number) ?? 0) + val;
        }
      }
    }
  }

  // Unsplit stats: take final cumulative value
  const lastTick = roundList[roundList.length - 1].endTick;
  const lastTickMap = byTickAndSteam.get(lastTick);

  for (const sid of steamIds) {
    const row = lastTickMap?.get(sid);
    if (!row) continue;
    const partial = out.get(sid)!;

    for (const prop of UNSPLIT_PROPS) {
      const val = (row[`${NS}.${prop}`] as number) ?? 0;
      partial[UNSPLIT_FIELDS[prop]] = val;
    }
  }

  return out;
}
