// TEMPORARY — CI diagnostic for #491's damage-side-split investigation. Runs the same check as
// `scripts/verify-damage-side-split.ts` inside the `frontend` CI job, which already carries live
// Supabase creds (needed for `next build`'s prerender), so its output lands in the PR's Actions log
// without needing local creds. Delete this file before merging.

import { describe, it, expect } from 'vitest';
import { getAdminClient } from './supabase-admin';
import { resolveSide } from './parsers/roundSides';
import type { Faction } from './types';

const hasLiveCreds = !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL;

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

describe.skipIf(!hasLiveCreds)('damage side-split diagnostic', () => {
  it('recomputed CT/T damage from match_damage_events vs stored damage_ct/damage_t', async () => {
    const admin = getAdminClient();

    type DamageRow = {
      match_id: number;
      round_number: number;
      attacker_player_match_stats_id: number | null;
      victim_player_match_stats_id: number;
      damage: number;
    };
    const damageEvents = await fetchAll<DamageRow>((from, to) =>
      admin
        .from('match_damage_events')
        .select('match_id, round_number, attacker_player_match_stats_id, victim_player_match_stats_id, damage')
        .not('attacker_player_match_stats_id', 'is', null)
        .range(from, to) as unknown as PromiseLike<{ data: DamageRow[] | null; error: { message: string } | null }>,
    );

    type RoundRow = { match_id: number; round_number: number; shirts_side: string };
    const roundRows = await fetchAll<RoundRow>((from, to) =>
      admin.from('match_rounds').select('match_id, round_number, shirts_side').range(from, to) as unknown as PromiseLike<
        { data: RoundRow[] | null; error: { message: string } | null }
      >,
    );
    const shirtsSideByRound = new Map<string, 'CT' | 'T'>();
    for (const r of roundRows) shirtsSideByRound.set(`${r.match_id}:${r.round_number}`, r.shirts_side as 'CT' | 'T');

    type PmsRow = { id: number; match_id: number; faction: Faction };
    const pmsRows = await fetchAll<PmsRow>((from, to) =>
      admin.from('player_match_stats').select('id, match_id, faction').range(from, to) as unknown as PromiseLike<
        { data: PmsRow[] | null; error: { message: string } | null }
      >,
    );
    const factionByPms = new Map<number, Faction>();
    for (const r of pmsRows) factionByPms.set(r.id, r.faction);

    type SabRow = { player_match_stats_id: number; damage_ct: number; damage_t: number };
    const sabRows = await fetchAll<SabRow>((from, to) =>
      admin.from('player_match_sabremetrics').select('player_match_stats_id, damage_ct, damage_t').range(
        from,
        to,
      ) as unknown as PromiseLike<{ data: SabRow[] | null; error: { message: string } | null }>,
    );
    const storedByPms = new Map<number, { ct: number; t: number }>();
    for (const r of sabRows) storedByPms.set(r.player_match_stats_id, { ct: r.damage_ct, t: r.damage_t });

    const derivedByPms = new Map<number, { ct: number; t: number }>();
    for (const e of damageEvents) {
      const attackerId = e.attacker_player_match_stats_id!;
      if (attackerId === e.victim_player_match_stats_id) continue;
      const attackerFaction = factionByPms.get(attackerId);
      const victimFaction = factionByPms.get(e.victim_player_match_stats_id);
      if (!attackerFaction || !victimFaction || attackerFaction === victimFaction) continue;

      const shirtsSide = shirtsSideByRound.get(`${e.match_id}:${e.round_number}`);
      if (!shirtsSide) continue;
      const side = resolveSide(shirtsSide, attackerFaction);
      const entry = derivedByPms.get(attackerId) ?? { ct: 0, t: 0 };
      if (side === 'CT') entry.ct += e.damage;
      else entry.t += e.damage;
      derivedByPms.set(attackerId, entry);
    }

    const tolerance = 10;
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

    console.log(`\n=== damage side-split diagnostic ===`);
    console.log(`damage events checked : ${damageEvents.length}`);
    console.log(`players checked       : ${storedByPms.size}`);
    console.log(`players over tolerance: ${worstCount}`);
    const pctDiff = totalStored > 0 ? (100 * (totalDerived - totalStored)) / totalStored : 0;
    console.log(`total stored damage   : ${totalStored}`);
    console.log(`total derived damage  : ${totalDerived} (${pctDiff >= 0 ? '+' : ''}${pctDiff.toFixed(2)}%)`);
    console.log(`player_match_stats_id | stored_ct | derived_ct | stored_t | derived_t | abs_diff`);
    for (const r of rows.slice(0, 40)) {
      console.log(
        `${String(r.pms).padStart(21)} | ${String(r.storedCt).padStart(9)} | ${String(r.derivedCt).padStart(10)} | ` +
          `${String(r.storedT).padStart(8)} | ${String(r.derivedT).padStart(9)} | ${r.absDiff}`,
      );
    }
    if (rows.length > 40) console.log(`... and ${rows.length - 40} more`);
    console.log('');

    expect(worstCount, `${worstCount} player(s) exceeded tolerance ${tolerance} — see console output above`).toBe(0);
  }, 60_000);
});
