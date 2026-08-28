import { parseTicks } from '@laihoe/demoparser2';
import type { SabFields } from '../types';
import type { MatchContext } from './matchContext';

type CollectorOut = Map<string, Partial<SabFields>>;

const NS = 'CCSPlayerController.CCSPlayerController_ActionTrackingServices';

// m_iKills/m_iDeaths/m_iAssists/m_iHeadShotKills aren't read here — kills_ct/_t, deaths_ct/_t,
// assists_ct/_t, and headshot_kills_ct/_t are all derived at query time instead
// (deriveSideSplitCounts() in queries/kills.ts, #488). m_iDamage stays: damage_ct/_t isn't a clean
// duplicate of any existing fact table (#491), so it's still collected live.
export const SPLIT_PROPS = ['m_iDamage'] as const;
// m_iEnemiesFlashed is not read here: enemies_flashed is derived at query time from
// match_utility_throws (queries/utility.ts's deriveUtilityCounts(), #489), which applies the
// half-blind (1.1s) threshold the engine's ungated netprop doesn't.
export const UNSPLIT_PROPS = ['m_iUtilityDamage'] as const;

export const SPLIT_FIELDS: Record<string, { ct: keyof SabFields; t: keyof SabFields }> = {
  m_iDamage: { ct: 'damage_ct', t: 'damage_t' },
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

  // Build per-round deltas for split stats
  const roundList = context.rounds;
  const prevValues = new Map<string, Map<string, number>>();
  for (const sid of steamIds) {
    const m = new Map<string, number>();
    for (const p of SPLIT_PROPS) m.set(p, 0);
    prevValues.set(sid, m);
  }

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
      const prev = prevValues.get(sid)!;
      const partial = out.get(sid)!;

      for (const prop of SPLIT_PROPS) {
        const curVal = (row[`${NS}.${prop}`] as number) ?? 0;
        const delta = curVal - (prev.get(prop) ?? 0);
        prev.set(prop, curVal);

        if (delta !== 0 && side && context.hasSides) {
          const fields = SPLIT_FIELDS[prop];
          const key = side === 'CT' ? fields.ct : fields.t;
          partial[key] = ((partial[key] as number) ?? 0) + delta;
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
