import { parseTicks } from '@laihoe/demoparser2';
import type { SabFields } from '../types';
import type { MatchContext } from './matchContext';

type CollectorOut = Map<string, Partial<SabFields>>;

const NS = 'CCSPlayerController.CCSPlayerController_ActionTrackingServices';

const SPLIT_PROPS = ['m_iKills', 'm_iDeaths', 'm_iAssists', 'm_iDamage', 'm_iHeadShotKills'] as const;
const UNSPLIT_PROPS = ['m_iUtilityDamage', 'm_iEnemiesFlashed'] as const;

const SPLIT_FIELDS: Record<string, { ct: keyof SabFields; t: keyof SabFields }> = {
  m_iKills: { ct: 'kills_ct', t: 'kills_t' },
  m_iDeaths: { ct: 'deaths_ct', t: 'deaths_t' },
  m_iAssists: { ct: 'assists_ct', t: 'assists_t' },
  m_iDamage: { ct: 'damage_ct', t: 'damage_t' },
  m_iHeadShotKills: { ct: 'headshot_kills_ct', t: 'headshot_kills_t' },
};

const UNSPLIT_FIELDS: Record<string, keyof SabFields> = {
  m_iUtilityDamage: 'utility_damage',
  m_iEnemiesFlashed: 'enemies_flashed',
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

  // Also read headshot_kills total from final tick
  for (const sid of steamIds) {
    const row = lastTickMap?.get(sid);
    if (!row) continue;
    const partial = out.get(sid)!;

    for (const prop of UNSPLIT_PROPS) {
      const val = (row[`${NS}.${prop}`] as number) ?? 0;
      partial[UNSPLIT_FIELDS[prop]] = val;
    }

    const hsTotal = (row[`${NS}.m_iHeadShotKills`] as number) ?? 0;
    partial.headshot_kills = hsTotal;

    // Sanity check: splits must sum to total
    const killsTotal = (row[`${NS}.m_iKills`] as number) ?? 0;
    const splitKills = ((partial.kills_ct as number) ?? 0) + ((partial.kills_t as number) ?? 0);
    if (splitKills !== killsTotal) {
      context.warnings.push(
        `Kills split mismatch for ${sid}: ${splitKills} (ct+t) vs ${killsTotal} (total).`,
      );
    }

    const deathsTotal = (row[`${NS}.m_iDeaths`] as number) ?? 0;
    const splitDeaths = ((partial.deaths_ct as number) ?? 0) + ((partial.deaths_t as number) ?? 0);
    if (splitDeaths !== deathsTotal) {
      context.warnings.push(
        `Deaths split mismatch for ${sid}: ${splitDeaths} (ct+t) vs ${deathsTotal} (total).`,
      );
    }

    const hsSplit = ((partial.headshot_kills_ct as number) ?? 0) + ((partial.headshot_kills_t as number) ?? 0);
    if (hsSplit !== hsTotal) {
      context.warnings.push(
        `HS kills split mismatch for ${sid}: ${hsSplit} (ct+t) vs ${hsTotal} (total).`,
      );
    }
  }

  return out;
}
