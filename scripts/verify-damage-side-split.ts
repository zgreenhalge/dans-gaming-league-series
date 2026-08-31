// Cross-checks `match_damage_events`-derived per-side damage totals against the live-collected
// `damage_ct`/`damage_t` accumulator on `player_match_sabremetrics`, using the same `resolveSide()`
// primitive the query layer uses everywhere else (`deriveSideSplitCounts()`, `deriveRoundsBySide()`)
// — so a mismatch here reflects the real side-resolution code, not a hand-rolled reimplementation of
// it. Enemy damage only (self-damage and teamdamage excluded), matching how `damage_ct`/`damage_t`
// is documented to behave.
//
// Needs Supabase creds in env (source .env.local first):
//   set -a; . ./.env.local; set +a
//   tsx scripts/verify-damage-side-split.ts
//   tsx scripts/verify-damage-side-split.ts --match 71
//   tsx scripts/verify-damage-side-split.ts --tolerance 5
//
// Flags:
//   --match <id>       limit to one match (default: every match with match_damage_events rows).
//   --tolerance <n>    per-player |stored - derived| sum (ct+t) above which a row is reported
//                       (default 10 — small residuals are expected from rounding/edge cases).
//
// Read-only — no writes. Exits 1 if any row exceeds --tolerance, so this can gate a CI/data-QA job.

import { getAdminClient } from '../src/lib/supabase-admin';
import { resolveSide } from '../src/lib/parsers/roundSides';
import type { Faction } from '../src/lib/types';

const PAGE_SIZE = 1000;

async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function parseArgs(argv: string[]): { match?: number; tolerance: number } {
  const out: { match?: number; tolerance: number } = { tolerance: 10 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--match') out.match = Number(argv[++i]);
    else if (argv[i] === '--tolerance') out.tolerance = Number(argv[++i]);
  }
  return out;
}

async function main() {
  const { match: matchFilter, tolerance } = parseArgs(process.argv.slice(2));
  const admin = getAdminClient();

  type DamageRow = {
    match_id: number;
    round_number: number;
    attacker_player_match_stats_id: number | null;
    victim_player_match_stats_id: number;
    damage: number;
  };
  const damageEvents = await fetchAll<DamageRow>((from, to) => {
    let q = admin
      .from('match_damage_events')
      .select('match_id, round_number, attacker_player_match_stats_id, victim_player_match_stats_id, damage')
      .not('attacker_player_match_stats_id', 'is', null)
      .range(from, to);
    if (matchFilter != null) q = q.eq('match_id', matchFilter);
    return q as unknown as PromiseLike<{ data: DamageRow[] | null; error: { message: string } | null }>;
  });

  type RoundRow = { match_id: number; round_number: number; shirts_side: string };
  const roundRows = await fetchAll<RoundRow>((from, to) => {
    let q = admin.from('match_rounds').select('match_id, round_number, shirts_side').range(from, to);
    if (matchFilter != null) q = q.eq('match_id', matchFilter);
    return q as unknown as PromiseLike<{ data: RoundRow[] | null; error: { message: string } | null }>;
  });
  const shirtsSideByRound = new Map<string, 'CT' | 'T'>();
  for (const r of roundRows) shirtsSideByRound.set(`${r.match_id}:${r.round_number}`, r.shirts_side as 'CT' | 'T');

  type PmsRow = { id: number; match_id: number; faction: Faction };
  const pmsRows = await fetchAll<PmsRow>((from, to) => {
    let q = admin.from('player_match_stats').select('id, match_id, faction').range(from, to);
    if (matchFilter != null) q = q.eq('match_id', matchFilter);
    return q as unknown as PromiseLike<{ data: PmsRow[] | null; error: { message: string } | null }>;
  });
  const factionByPms = new Map<number, Faction>();
  for (const r of pmsRows) factionByPms.set(r.id, r.faction);

  type SabRow = { player_match_stats_id: number; damage_ct: number; damage_t: number };
  const sabRows = await fetchAll<SabRow>((from, to) =>
    admin
      .from('player_match_sabremetrics')
      .select('player_match_stats_id, damage_ct, damage_t')
      .range(from, to) as unknown as PromiseLike<{ data: SabRow[] | null; error: { message: string } | null }>,
  );
  const storedByPms = new Map<number, { ct: number; t: number }>();
  for (const r of sabRows) storedByPms.set(r.player_match_stats_id, { ct: r.damage_ct, t: r.damage_t });

  const derivedByPms = new Map<number, { ct: number; t: number }>();
  let skippedNoRound = 0;
  for (const e of damageEvents) {
    const attackerId = e.attacker_player_match_stats_id!;
    if (attackerId === e.victim_player_match_stats_id) continue; // self-damage
    const attackerFaction = factionByPms.get(attackerId);
    const victimFaction = factionByPms.get(e.victim_player_match_stats_id);
    if (!attackerFaction || !victimFaction || attackerFaction === victimFaction) continue; // teamdamage / unresolved

    const shirtsSide = shirtsSideByRound.get(`${e.match_id}:${e.round_number}`);
    if (!shirtsSide) {
      skippedNoRound++;
      continue;
    }
    const side = resolveSide(shirtsSide, attackerFaction);
    const entry = derivedByPms.get(attackerId) ?? { ct: 0, t: 0 };
    if (side === 'CT') entry.ct += e.damage;
    else entry.t += e.damage;
    derivedByPms.set(attackerId, entry);
  }

  console.log(`\n=== damage side-split verification ===`);
  console.log(`damage events checked : ${damageEvents.length}`);
  if (skippedNoRound > 0) console.log(`skipped (no match_rounds row for that round) : ${skippedNoRound}`);
  console.log(`tolerance             : ${tolerance}\n`);

  let worstCount = 0;
  let totalStored = 0;
  let totalDerived = 0;
  const rows: { pms: number; storedCt: number; derivedCt: number; storedT: number; derivedT: number; absDiff: number }[] = [];

  for (const [pms, stored] of storedByPms) {
    const derived = derivedByPms.get(pms) ?? { ct: 0, t: 0 };
    const absDiff = Math.abs(stored.ct - derived.ct) + Math.abs(stored.t - derived.t);
    totalStored += stored.ct + stored.t;
    totalDerived += derived.ct + derived.t;
    if (absDiff > tolerance) {
      worstCount++;
      rows.push({ pms, storedCt: stored.ct, derivedCt: derived.ct, storedT: stored.t, derivedT: derived.t, absDiff });
    }
  }
  rows.sort((a, b) => b.absDiff - a.absDiff);

  console.log(`player_match_stats_id | stored_ct | derived_ct | stored_t | derived_t | abs_diff`);
  for (const r of rows.slice(0, 40)) {
    console.log(
      `${String(r.pms).padStart(21)} | ${String(r.storedCt).padStart(9)} | ${String(r.derivedCt).padStart(10)} | ` +
        `${String(r.storedT).padStart(8)} | ${String(r.derivedT).padStart(9)} | ${r.absDiff}`,
    );
  }
  if (rows.length > 40) console.log(`... and ${rows.length - 40} more`);

  const pctDiff = totalStored > 0 ? (100 * (totalDerived - totalStored)) / totalStored : 0;
  console.log(`\nplayers over tolerance : ${worstCount} / ${storedByPms.size}`);
  console.log(`total stored damage    : ${totalStored}`);
  console.log(`total derived damage   : ${totalDerived} (${pctDiff >= 0 ? '+' : ''}${pctDiff.toFixed(2)}%)\n`);

  process.exit(worstCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
