import type { MatchContext, PlayerHurtRow } from './matchContext';
import { isTeamKill } from './matchContext';
import type { WeaponFireRow } from './utility';
import { WEAPON_CATEGORY, stripWeaponPrefix } from './weaponClasses';
import type { EconomyType } from './economy';
import { HITGROUP_HEAD } from './constants';

export interface WeaponBreakdownRow {
  bucket: string;
  shots_fired: number;
  shots_hit: number;
  headshot_hits: number;
  damage_dealt: number;
  rounds_played: number;
}

function getOrCreate(
  buckets: Map<string, WeaponBreakdownRow>,
  key: string,
): WeaponBreakdownRow {
  let b = buckets.get(key);
  if (!b) {
    b = { bucket: key, shots_fired: 0, shots_hit: 0, headshot_hits: 0, damage_dealt: 0, rounds_played: 0 };
    buckets.set(key, b);
  }
  return b;
}

/**
 * Per-weapon-category shot/accuracy/damage/rounds breakdown (#279). WEAPON_CATEGORY is an
 * allowlist of real guns, so grenade/knife/C4 events fall through unbucketed with no separate
 * exclusion list needed (unlike accuracy.ts's NON_GUN_* sets). `rounds_played` for a category is
 * the count of distinct live rounds in which the player fired that category at least once.
 */
export function collectWeaponClassStats(
  fireEvents: WeaponFireRow[],
  hurtEvents: PlayerHurtRow[],
  context: MatchContext,
  steamIds: string[],
): Map<string, WeaponBreakdownRow[]> {
  const steamSet = new Set(steamIds);
  const perPlayer = new Map<string, Map<string, WeaponBreakdownRow>>();
  const roundsSeen = new Map<string, Set<number>>(); // `${steamid}::${category}` -> rounds
  for (const sid of steamIds) perPlayer.set(sid, new Map());

  for (const f of fireEvents) {
    const category = WEAPON_CATEGORY[stripWeaponPrefix(f.weapon)];
    if (!category) continue;
    const round = f.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    const shooter = f.user_steamid;
    if (!shooter || !steamSet.has(shooter)) continue;

    const b = getOrCreate(perPlayer.get(shooter)!, category);
    b.shots_fired += 1;
    const seenKey = `${shooter}::${category}`;
    let rounds = roundsSeen.get(seenKey);
    if (!rounds) { rounds = new Set(); roundsSeen.set(seenKey, rounds); }
    if (!rounds.has(round)) { rounds.add(round); b.rounds_played += 1; }
  }

  for (const h of hurtEvents) {
    const category = WEAPON_CATEGORY[h.weapon];
    if (!category) continue;
    const round = h.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;

    const attacker = h.attacker_steamid;
    const victim = h.user_steamid;
    if (!attacker || !steamSet.has(attacker)) continue;
    if (!victim || !steamSet.has(victim)) continue;
    if (attacker === victim) continue;
    if (isTeamKill(attacker, victim, context)) continue;

    const b = getOrCreate(perPlayer.get(attacker)!, category);
    b.shots_hit += 1;
    b.damage_dealt += h.dmg_health;
    if (h.hitgroup === HITGROUP_HEAD) b.headshot_hits += 1;
  }

  const out = new Map<string, WeaponBreakdownRow[]>();
  for (const [sid, buckets] of perPlayer) out.set(sid, [...buckets.values()]);
  return out;
}

/**
 * Per-round-economy shot/accuracy/damage/rounds breakdown (#279). `rounds_played` is seeded
 * directly from `roundEconomy` (one bucket per live round the player was classified in) rather
 * than derived from shot events, since a round with zero shots fired still counts toward its
 * economy tier — unlike the weapon-category breakdown above, where "played" is shot-triggered.
 */
export function collectEconomyStats(
  fireEvents: WeaponFireRow[],
  hurtEvents: PlayerHurtRow[],
  roundEconomy: Map<string, Map<number, EconomyType>>,
  context: MatchContext,
  steamIds: string[],
): Map<string, WeaponBreakdownRow[]> {
  const steamSet = new Set(steamIds);
  const perPlayer = new Map<string, Map<string, WeaponBreakdownRow>>();
  for (const sid of steamIds) perPlayer.set(sid, new Map());

  for (const sid of steamIds) {
    const byRound = roundEconomy.get(sid);
    if (!byRound) continue;
    for (const type of byRound.values()) {
      getOrCreate(perPlayer.get(sid)!, type).rounds_played += 1;
    }
  }

  for (const f of fireEvents) {
    const round = f.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    const shooter = f.user_steamid;
    if (!shooter || !steamSet.has(shooter)) continue;
    const type = roundEconomy.get(shooter)?.get(round);
    if (!type) continue;

    getOrCreate(perPlayer.get(shooter)!, type).shots_fired += 1;
  }

  for (const h of hurtEvents) {
    const round = h.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;

    const attacker = h.attacker_steamid;
    const victim = h.user_steamid;
    if (!attacker || !steamSet.has(attacker)) continue;
    if (!victim || !steamSet.has(victim)) continue;
    if (attacker === victim) continue;
    if (isTeamKill(attacker, victim, context)) continue;

    const type = roundEconomy.get(attacker)?.get(round);
    if (!type) continue;

    const b = getOrCreate(perPlayer.get(attacker)!, type);
    b.shots_hit += 1;
    b.damage_dealt += h.dmg_health;
    if (h.hitgroup === HITGROUP_HEAD) b.headshot_hits += 1;
  }

  const out = new Map<string, WeaponBreakdownRow[]>();
  for (const [sid, buckets] of perPlayer) out.set(sid, [...buckets.values()]);
  return out;
}
