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
 * Per-weapon shot/accuracy/damage/rounds breakdown (#279, #474) — bucketed by the exact weapon
 * classname (e.g. `ak47`), not by category; `player_match_weapon_stats` derives category from it
 * at read time (`WEAPON_CATEGORY[weapon]`, `queries/weaponStats.ts`) instead of storing it
 * redundantly, the same relationship `killWeaponCategory()` already has to `match_kills.weapon`.
 * `WEAPON_CATEGORY` is still the gun-only inclusion gate — grenade/knife/C4 events fall through
 * unbucketed with no separate exclusion list needed (unlike accuracy.ts's NON_GUN_* sets) — only
 * what a bucket is keyed by changed, not which fire/hurt events count at all. `rounds_played` for a
 * weapon is the count of distinct live rounds in which the player fired that weapon at least once.
 */
export function collectWeaponClassStats(
  fireEvents: WeaponFireRow[],
  hurtEvents: PlayerHurtRow[],
  context: MatchContext,
  steamIds: string[],
): Map<string, WeaponBreakdownRow[]> {
  const steamSet = new Set(steamIds);
  const perPlayer = makePerPlayerBuckets(steamIds);
  const roundsSeen = new Map<string, Set<number>>(); // `${steamid}::${weapon}` -> rounds

  for (const f of fireEvents) {
    const weapon = stripWeaponPrefix(f.weapon);
    if (!WEAPON_CATEGORY[weapon]) continue;
    const round = roundOf(f, context);
    if (round == null) continue;
    const shooter = f.user_steamid;
    if (!shooter || !steamSet.has(shooter)) continue;

    const b = getOrCreate(perPlayer.get(shooter)!, weapon);
    b.shots_fired += 1;
    const seenKey = `${shooter}::${weapon}`;
    let rounds = roundsSeen.get(seenKey);
    if (!rounds) { rounds = new Set(); roundsSeen.set(seenKey, rounds); }
    if (!rounds.has(round)) { rounds.add(round); b.rounds_played += 1; }
  }

  accumulateHurtDamage(hurtEvents, context, steamSet, perPlayer, (h) => (WEAPON_CATEGORY[h.weapon] ? h.weapon : undefined));

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
  noscope: boolean;
  wallbang: boolean;
  blind_kill: boolean;
  midair: boolean;
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
 * Expects `deathEvents` already deduped to at most one event per (round, victim) —
 * `dedupeDeathEvents()` (`matchContext.ts`), applied once upstream to every event-based collector's
 * shared `deathEvents` stream, not re-guarded here. A player can die at most once in a live round,
 * so `match_kills` enforces `unique (round, victim)`; without that upstream dedup this collector
 * would be the only one of ~10 sharing `deathEvents` that noticed a duplicate, and every other
 * consumer (KAST, trades, multikills, ...) would silently double-count it instead.
 */
export function collectMatchKills(
  deathEvents: PlayerDeathRow[],
  context: MatchContext,
  steamIds: string[],
  /** `${tick}:${attackerSteamId}` → was the attacker airborne — see `collectMidairAttackers()`
   *  (`matchContext.ts`). */
  midairByTickSteam: Map<string, boolean>,
): KillFactRow[] {
  const steamSet = new Set(steamIds);
  const rows: KillFactRow[] = [];

  for (const d of deathEvents) {
    const round = roundOf(d, context);
    if (round == null) continue;

    const victim = d.user_steamid;
    if (!victim || !steamSet.has(victim)) continue;

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
      noscope: d.noscope,
      wallbang: d.penetrated > 0,
      blind_kill: d.attackerblind,
      midair: d.attacker_steamid ? (midairByTickSteam.get(`${d.tick}:${d.attacker_steamid}`) ?? false) : false,
      is_teamkill: isTk,
      tick: d.tick,
    });
  }

  return rows;
}

export interface DamageEventFactRow {
  round_number: number;
  attacker_steamid: string | null;
  victim_steamid: string;
  weapon: string;
  damage: number;
  hitgroup: string;
  tick: number;
}

/** A live round always starts every player at full health, with no mid-round regen (no health kits
 *  in Wingman) — the ceiling `clampToHealthRemaining()` clamps each round's damage against. */
const STARTING_HEALTH = 100;

/**
 * Clamps each row's `damage` down to what the victim actually had left that round, mirroring the
 * engine's own `m_iDamage` accumulator (`docs/calculations.md`) rather than `player_hurt`'s raw
 * `dmg_health` — a `player_hurt` event's damage isn't itself capped at the victim's remaining
 * health, so a kill's finishing hit(s) routinely report more "damage" than the victim had left
 * (most visibly on shotguns, whose per-pellet damage isn't individually capped either), and a
 * straight sum of unclamped rows overcounts a match's total damage by a large margin (confirmed
 * against real reparsed matches, #491). Health is shared across every attacker who hits a given
 * victim that round — a self-damage or teamdamage hit draws from the same pool a kill shot does —
 * so this clamps per (round, victim) regardless of who's hitting them, walking hits in ascending
 * tick order (ties keep their original relative order — `hurtEvents` is already tick-ordered, and
 * `Array.prototype.sort` is stable) and flooring each one against whatever health remained. Mutates
 * `rows` in place.
 */
function clampToHealthRemaining(rows: DamageEventFactRow[]): void {
  const byRoundVictim = new Map<string, DamageEventFactRow[]>();
  for (const r of rows) {
    const key = `${r.round_number}:${r.victim_steamid}`;
    let group = byRoundVictim.get(key);
    if (!group) {
      group = [];
      byRoundVictim.set(key, group);
    }
    group.push(r);
  }

  for (const group of byRoundVictim.values()) {
    group.sort((a, b) => a.tick - b.tick);
    let remaining = STARTING_HEALTH;
    for (const r of group) {
      r.damage = Math.min(r.damage, remaining);
      remaining -= r.damage;
    }
  }
}

/**
 * One row per `player_hurt` event — a `match_damage_events` fact table row, same grain and
 * "downstream queries decide" convention `collectMatchKills()` follows: self-damage and teamdamage
 * are kept, not filtered (unlike `accumulateHurtDamage()`'s `shots_hit`/`damage_dealt` breakdowns
 * above, which gate both out since those feed player-facing "damage to enemies" totals).
 * `attacker_steamid` is nulled out when it's not a known roster player (world/fall damage), matching
 * `collectMatchKills()`'s handling of unresolvable attackers. Every hit is kept regardless of
 * `weapon` — grenade/utility damage (`hegrenade`, `molotov`/`inferno`) included alongside guns, so
 * this table needs no separate reconciliation against `match_utility_throws` (which only tracks
 * flash-blind instances, not damage) to cover utility. `damage` is health actually lost, not the
 * event's raw `dmg_health` — see `clampToHealthRemaining()`.
 */
export function collectMatchDamageEvents(
  hurtEvents: PlayerHurtRow[],
  context: MatchContext,
  steamIds: string[],
): DamageEventFactRow[] {
  const steamSet = new Set(steamIds);
  const rows: DamageEventFactRow[] = [];

  for (const h of hurtEvents) {
    const round = roundOf(h, context);
    if (round == null) continue;

    const victim = h.user_steamid;
    if (!victim || !steamSet.has(victim)) continue;

    const attacker = h.attacker_steamid && steamSet.has(h.attacker_steamid) ? h.attacker_steamid : null;

    rows.push({
      round_number: round,
      attacker_steamid: attacker,
      victim_steamid: victim,
      weapon: h.weapon,
      damage: h.dmg_health,
      hitgroup: h.hitgroup,
      tick: h.tick,
    });
  }

  clampToHealthRemaining(rows);
  return rows;
}
