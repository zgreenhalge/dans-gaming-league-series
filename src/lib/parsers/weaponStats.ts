import type { MatchContext, PlayerDeathRow, PlayerHurtRow } from './matchContext';
import { isTeamKill } from './matchContext';
import type { WeaponFireRow } from './utility';
import { WEAPON_CATEGORY, stripWeaponPrefix } from './weaponClasses';
import type { EconomyType } from './economy';
import { HITGROUP_HEAD } from './constants';
import { roundOf } from './_shared';

export interface WeaponBreakdownRow {
  bucket: string;
  shots_fired: number;
  shots_hit: number;
  headshot_hits: number;
  damage_dealt: number;
  rounds_played: number;
}

type PerPlayerBuckets = Map<string, Map<string, WeaponBreakdownRow>>;

function getOrCreate(buckets: Map<string, WeaponBreakdownRow>, key: string): WeaponBreakdownRow {
  let b = buckets.get(key);
  if (!b) {
    b = { bucket: key, shots_fired: 0, shots_hit: 0, headshot_hits: 0, damage_dealt: 0, rounds_played: 0 };
    buckets.set(key, b);
  }
  return b;
}

function makePerPlayerBuckets(steamIds: string[]): PerPlayerBuckets {
  const perPlayer: PerPlayerBuckets = new Map();
  for (const sid of steamIds) perPlayer.set(sid, new Map());
  return perPlayer;
}

function flattenBuckets(perPlayer: PerPlayerBuckets): Map<string, WeaponBreakdownRow[]> {
  const out = new Map<string, WeaponBreakdownRow[]>();
  for (const [sid, buckets] of perPlayer) out.set(sid, [...buckets.values()]);
  return out;
}

/**
 * Shared by both collectors below — accumulates `shots_hit`/`damage_dealt`/`headshot_hits` from
 * `hurtEvents` into whichever bucket `getBucket` resolves for that hit, applying the same
 * self-damage/teamdamage/steamid-membership guards both breakdowns need. `getBucket` returning
 * `undefined` (an uncategorized weapon, or a round with no economy classification) drops the hit.
 */
function accumulateHurtDamage(
  hurtEvents: PlayerHurtRow[],
  context: MatchContext,
  steamSet: Set<string>,
  perPlayer: PerPlayerBuckets,
  getBucket: (h: PlayerHurtRow, round: number) => string | undefined,
): void {
  for (const h of hurtEvents) {
    const round = roundOf(h, context);
    if (round == null) continue;

    const attacker = h.attacker_steamid;
    const victim = h.user_steamid;
    if (!attacker || !steamSet.has(attacker)) continue;
    if (!victim || !steamSet.has(victim)) continue;
    if (attacker === victim) continue;
    if (isTeamKill(attacker, victim, context)) continue;

    const bucket = getBucket(h, round);
    if (!bucket) continue;

    const b = getOrCreate(perPlayer.get(attacker)!, bucket);
    b.shots_hit += 1;
    b.damage_dealt += h.dmg_health;
    if (h.hitgroup === HITGROUP_HEAD) b.headshot_hits += 1;
  }
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
  const perPlayer = makePerPlayerBuckets(steamIds);
  const roundsSeen = new Map<string, Set<number>>(); // `${steamid}::${category}` -> rounds

  for (const f of fireEvents) {
    const category = WEAPON_CATEGORY[stripWeaponPrefix(f.weapon)];
    if (!category) continue;
    const round = roundOf(f, context);
    if (round == null) continue;
    const shooter = f.user_steamid;
    if (!shooter || !steamSet.has(shooter)) continue;

    const b = getOrCreate(perPlayer.get(shooter)!, category);
    b.shots_fired += 1;
    const seenKey = `${shooter}::${category}`;
    let rounds = roundsSeen.get(seenKey);
    if (!rounds) { rounds = new Set(); roundsSeen.set(seenKey, rounds); }
    if (!rounds.has(round)) { rounds.add(round); b.rounds_played += 1; }
  }

  accumulateHurtDamage(hurtEvents, context, steamSet, perPlayer, (h) => WEAPON_CATEGORY[h.weapon]);

  return flattenBuckets(perPlayer);
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
  const perPlayer = makePerPlayerBuckets(steamIds);

  for (const sid of steamIds) {
    const byRound = roundEconomy.get(sid);
    if (!byRound) continue;
    for (const type of byRound.values()) {
      getOrCreate(perPlayer.get(sid)!, type).rounds_played += 1;
    }
  }

  for (const f of fireEvents) {
    const round = roundOf(f, context);
    if (round == null) continue;
    const shooter = f.user_steamid;
    if (!shooter || !steamSet.has(shooter)) continue;
    const type = roundEconomy.get(shooter)?.get(round);
    if (!type) continue;

    getOrCreate(perPlayer.get(shooter)!, type).shots_fired += 1;
  }

  accumulateHurtDamage(
    hurtEvents, context, steamSet, perPlayer,
    (h, round) => roundEconomy.get(h.attacker_steamid!)?.get(round),
  );

  return flattenBuckets(perPlayer);
}

export interface KillFactRow {
  round_number: number;
  attacker_steamid: string | null;
  victim_steamid: string;
  assister_steamid: string | null;
  weapon: string;
  headshot: boolean;
  is_teamkill: boolean;
  tick: number;
}

/**
 * One row per kill event — a `match_kills` fact table row, not a per-player aggregate (unlike
 * every other collector in this file). Kept flat so downstream queries decide at read time what
 * counts as a "kill" (attacker known, not a self-kill, not a teamkill) rather than baking those
 * judgment calls into the collector. `attacker_steamid`/`assister_steamid` are nulled out when
 * they're not a known roster player (world/environment kills, e.g. fall damage), matching the
 * `steamSet` gating every other collector in this file applies.
 *
 * A player can die at most once in a live round, so `match_kills` enforces `unique (round,
 * victim)`. `roundOf()` (`_shared.ts`) already excludes warmup/pre-match-start events by tick, not
 * just by round-number offset — the actual bug that surfaced this constraint originally (a
 * warmup-period death whose `total_rounds_played` coincidentally matched a live round number) is
 * fixed there, for every collector, not band-aided here. If two events still land on the same
 * (round, victim) after that, it's a genuine anomaly (e.g. a duplicated `player_death` from
 * demoparser2 itself) worth a human look, not something to paper over silently: it's recorded to
 * `context.warnings` (which gates auto-commit — see `evaluateAutoCommit()` — so the match routes
 * to manual review instead of confirming with a quietly-dropped kill) and only the first event is
 * kept, since the table's constraint still requires exactly one row.
 */
export function collectMatchKills(
  deathEvents: PlayerDeathRow[],
  context: MatchContext,
  steamIds: string[],
): KillFactRow[] {
  const steamSet = new Set(steamIds);
  const rows: KillFactRow[] = [];
  const seenRoundVictims = new Set<string>();

  for (const d of deathEvents) {
    const round = roundOf(d, context);
    if (round == null) continue;

    const victim = d.user_steamid;
    if (!victim || !steamSet.has(victim)) continue;

    const dedupeKey = `${round}::${victim}`;
    if (seenRoundVictims.has(dedupeKey)) {
      context.warnings.push(
        `Duplicate player_death for ${victim} in round ${round} — kept the first, dropped the rest.`,
      );
      continue;
    }
    seenRoundVictims.add(dedupeKey);

    const attacker = d.attacker_steamid && steamSet.has(d.attacker_steamid) ? d.attacker_steamid : null;
    const assister = d.assister_steamid && steamSet.has(d.assister_steamid) ? d.assister_steamid : null;
    const isTk = attacker != null && attacker !== victim && isTeamKill(attacker, victim, context);

    rows.push({
      round_number: round,
      attacker_steamid: attacker,
      victim_steamid: victim,
      assister_steamid: assister,
      weapon: d.weapon,
      headshot: d.headshot,
      is_teamkill: isTk,
      tick: d.tick,
    });
  }

  return rows;
}
