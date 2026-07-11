// Core of a match score write — validates the payload, writes `matches.final_score` +
// `player_match_stats`, persists sabremetrics, and runs the rating-recompute + gauntlet-or-season
// completion + steam-id-learning hooks. Shared by the session-gated
// `PATCH /api/matches/[id]/score` route (human confirm) and the demo-ingest Action's trusted
// auto-commit (#138), so the write behaves identically regardless of who triggers it.
//
// Has no dependency on `next/server` — the demo-ingest Action runs this outside any request scope, so
// `after()` isn't available there. Pass `opts.after` (the route's own `after` import) to defer the
// hooks past the HTTP response; omit it to await them directly, which the Action needs since its
// process exits once `main()` returns.

import type { SupabaseClient } from '@supabase/supabase-js';
import { triggerRatingRecompute } from './ehog-recompute';
import { parseEliminationWarning } from './parsers/rosterResolver';
import { persistSabremetrics, clearSabremetrics } from './demo/sabremetrics';
import { resolveAndPropagate } from './gauntlet-engine';
import { checkSeasonCompletion, checkGauntletCompletion } from './season-lifecycle';
import { recordOpsError, clearOpsError } from './ops-errors';
import type { DemoSabremetricStat, RoundHistoryEntry } from './types';

type PlayerStatInput = {
  player_id: number;
  kills: number;
  assists: number;
  deaths: number;
  damage: number;
  adr?: number | null;
};

const ROUND_CONDITIONS = new Set(['elim', 'bomb', 'defuse', 'time']);

/**
 * Validate the optional round-history payload. Returns a clean array, or null
 * if absent/malformed — never throws, since this data is display-only.
 */
function sanitizeRoundHistory(input: unknown): RoundHistoryEntry[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const clean: RoundHistoryEntry[] = [];
  for (const r of input) {
    if (!r || typeof r !== 'object') return null;
    const { n, winner, side, condition } = r as Record<string, unknown>;
    if (
      typeof n !== 'number' ||
      !Number.isInteger(n) ||
      (winner !== 'SHIRTS' && winner !== 'SKINS') ||
      (side !== 'CT' && side !== 'T') ||
      typeof condition !== 'string' ||
      !ROUND_CONDITIONS.has(condition)
    ) {
      return null;
    }
    clean.push({ n, winner, side, condition: condition as RoundHistoryEntry['condition'] });
  }
  return clean;
}

/**
 * Persist demo-learned steam ids. When exactly one player in this match was resolved by elimination
 * (the ambiguous fallback), the warning carries that demo's steam id + the roster player it was
 * matched to — write it onto the player so future parses resolve by exact id. Guarded to the
 * single-elimination case only; a unique-constraint hit is skipped (that id belongs to someone else).
 */
async function applyEliminationSteamIds(
  supabaseAdmin: SupabaseClient,
  matchId: number,
  warnings: string[],
): Promise<void> {
  const elims = warnings
    .map(parseEliminationWarning)
    .filter((e): e is NonNullable<typeof e> => e !== null);
  if (elims.length !== 1) return; // safety: only when a single player was inferred
  const { rosterName, steamId, demoName } = elims[0];

  const { data: statRows } = await supabaseAdmin
    .from('player_match_stats')
    .select('player_id')
    .eq('match_id', matchId);
  const ids = ((statRows ?? []) as { player_id: number }[]).map((r) => r.player_id);
  if (ids.length === 0) return;

  const { data: players } = await supabaseAdmin.from('players').select('id, name').in('id', ids);
  const target = ((players ?? []) as { id: number; name: string }[]).find((p) => p.name === rosterName);
  if (!target) return;

  // Never duplicate a steam id across players — don't rely on a DB constraint that may not exist.
  const { data: clash } = await supabaseAdmin
    .from('players')
    .select('id')
    .eq('steam_id', steamId)
    .neq('id', target.id)
    .limit(1);
  if (clash && clash.length > 0) {
    console.warn(`learn steam id skipped: ${steamId} already belongs to player ${(clash[0] as { id: number }).id}`);
    return;
  }

  const { error } = await supabaseAdmin
    .from('players')
    .update({ steam_id: steamId, steam_nickname: demoName })
    .eq('id', target.id);
  if (error) console.warn(`learn steam id skipped for player ${target.id}: ${error.message}`);
}

export interface WriteMatchScoreInput {
  shirts: unknown;
  skins: unknown;
  player_stats: unknown;
  sabremetrics?: DemoSabremetricStat[];
  round_history?: unknown;
  /** Parser warnings, forwarded so a single elimination-resolved match can learn a steam id. Only
   *  applied when `opts.learnSteamIds` is set. */
  warnings?: string[];
}

export interface WriteMatchScoreOptions {
  /** Learn a demo-resolved steam id from a single elimination warning. Admin-only in the interactive
   *  route (a non-admin caller could otherwise forge a warning to hijack another player's steam
   *  identity); the demo-ingest Action never sets this since auto-commit requires zero warnings. */
  learnSteamIds?: boolean;
  /** The calling request's `after()` (from `next/server`) — defers the recompute/gauntlet/season hooks
   *  past the HTTP response. Omit outside a request scope (the demo-ingest Action), where the hooks
   *  are awaited directly instead so they finish before the process exits. */
  after?: (fn: () => void | Promise<void>) => void;
}

export type WriteMatchScoreResult = { ok: true } | { ok: false; error: string; status: number };

export async function writeMatchScore(
  supabaseAdmin: SupabaseClient,
  matchId: number,
  input: WriteMatchScoreInput,
  opts: WriteMatchScoreOptions = {},
): Promise<WriteMatchScoreResult> {
  const { shirts, skins, player_stats, sabremetrics, round_history, warnings } = input;

  if (typeof shirts !== 'number' || typeof skins !== 'number' || !Number.isInteger(shirts) || !Number.isInteger(skins)) {
    return { ok: false, error: 'shirts and skins must be integers', status: 400 };
  }
  if (shirts < 0 || skins < 0) {
    return { ok: false, error: 'Scores cannot be negative', status: 400 };
  }
  if (!Array.isArray(player_stats) || player_stats.length === 0) {
    return { ok: false, error: 'player_stats must be a non-empty array', status: 400 };
  }

  const { data: matchRow } = await supabaseAdmin
    .from('matches')
    .select('id, weeks(season_id, seasons(is_gauntlet))')
    .eq('id', matchId)
    .maybeSingle();
  if (!matchRow) return { ok: false, error: 'Match not found', status: 404 };
  const m = matchRow as unknown as { weeks: { season_id: number; seasons: { is_gauntlet: boolean } } };
  const isGauntlet = m.weeks?.seasons?.is_gauntlet ?? false;

  const { data: matchStats } = await supabaseAdmin
    .from('player_match_stats')
    .select('player_id, faction')
    .eq('match_id', matchId);
  const allStats = (matchStats ?? []) as { player_id: number; faction: string }[];
  const statsByPlayerId = new Map<number, { player_id: number; faction: string }>();
  for (const s of allStats) statsByPlayerId.set(s.player_id, s);

  const roundsPlayed = shirts + skins;

  const updates: Array<{
    player_id: number;
    kills: number;
    assists: number;
    deaths: number;
    damage: number;
    adr: number;
    rounds_played: number;
    rounds_won: number;
    is_win: boolean;
  }> = [];

  for (const row of player_stats as PlayerStatInput[]) {
    if (typeof row.player_id !== 'number') {
      return { ok: false, error: 'Each stat row must have a numeric player_id', status: 400 };
    }
    const statRow = statsByPlayerId.get(row.player_id);
    if (!statRow) {
      return { ok: false, error: `player_id ${row.player_id} is not in this match`, status: 400 };
    }
    for (const field of ['kills', 'assists', 'deaths', 'damage'] as const) {
      if (typeof row[field] !== 'number' || !Number.isInteger(row[field]) || row[field] < 0) {
        return {
          ok: false,
          error: `${field} must be a non-negative integer for player_id ${row.player_id}`,
          status: 400,
        };
      }
    }
    if (row.adr != null && (typeof row.adr !== 'number' || row.adr < 0)) {
      return {
        ok: false,
        error: `adr must be a non-negative number for player_id ${row.player_id}`,
        status: 400,
      };
    }

    const faction = statRow.faction;
    const roundsWon = faction === 'SHIRTS' ? shirts : skins;
    const isWin = faction === 'SHIRTS' ? shirts > skins : skins > shirts;
    const adr =
      row.adr != null
        ? Math.round(row.adr)
        : roundsPlayed > 0
          ? Math.round(row.damage / roundsPlayed)
          : 0;

    updates.push({
      player_id: row.player_id,
      kills: row.kills,
      assists: row.assists,
      deaths: row.deaths,
      damage: row.damage,
      adr,
      rounds_played: roundsPlayed,
      rounds_won: roundsWon,
      is_win: isWin,
    });
  }

  const roundHistory = sanitizeRoundHistory(round_history);

  const finalScore = `${shirts}-${skins}`;
  const { error: matchErr } = await supabaseAdmin
    .from('matches')
    .update({ final_score: finalScore, round_history: roundHistory })
    .eq('id', matchId);
  if (matchErr) return { ok: false, error: matchErr.message, status: 500 };

  for (const u of updates) {
    const { error: statErr } = await supabaseAdmin
      .from('player_match_stats')
      .update({
        kills: u.kills,
        assists: u.assists,
        deaths: u.deaths,
        damage: u.damage,
        adr: u.adr,
        rounds_played: u.rounds_played,
        rounds_won: u.rounds_won,
        is_win: u.is_win,
      })
      .eq('match_id', matchId)
      .eq('player_id', u.player_id);
    if (statErr) return { ok: false, error: statErr.message, status: 500 };
  }

  // Sabremetrics: upsert or clean up (non-fatal — never rolls back the committed score)
  try {
    if (sabremetrics && sabremetrics.length > 0) {
      await persistSabremetrics(matchId, sabremetrics);
    } else {
      await clearSabremetrics(matchId);
    }
    await clearOpsError(supabaseAdmin, 'match', matchId, 'sabremetrics_persist');
  } catch (e) {
    console.error('Sabremetrics write/delete failed (non-fatal):', e);
    await recordOpsError(supabaseAdmin, 'match', matchId, 'sabremetrics_persist', `Sabremetrics write failed: ${(e as Error).message}`);
  }

  // Independent hooks — run concurrently (each already isolates its own failure) rather than
  // serializing behind the recompute's fetch, which never gates the others.
  const runHooks = async (): Promise<void> => {
    await Promise.all([
      triggerRatingRecompute(supabaseAdmin),
      (async () => {
        if (isGauntlet) {
          // Completion must run after propagation resolves — otherwise it can see an incomplete
          // round (the final round not yet materialized) as "every existing match played" and
          // archive early.
          try {
            await resolveAndPropagate(supabaseAdmin, matchId);
          } catch (err) {
            console.error(`gauntlet propagate(${matchId}) failed:`, err);
          }
          try {
            await checkGauntletCompletion(supabaseAdmin, m.weeks.season_id);
          } catch (err) {
            console.error(`gauntlet completion check(${m.weeks.season_id}) failed:`, err);
          }
        } else {
          try {
            await checkSeasonCompletion(supabaseAdmin, m.weeks.season_id);
          } catch (err) {
            console.error(`season completion check(${m.weeks.season_id}) failed:`, err);
          }
        }
      })(),
      (async () => {
        // `warnings` may be an empty array (a clean confirm) — still clear a stale ops error;
        // elimination-learning itself is only meaningful with at least one warning to parse.
        if (!opts.learnSteamIds || !warnings) return;
        try {
          if (warnings.length > 0) await applyEliminationSteamIds(supabaseAdmin, matchId, warnings);
          await clearOpsError(supabaseAdmin, 'match', matchId, 'steam_id_learn');
        } catch (err) {
          console.error(`learn steam id(${matchId}) failed:`, err);
          await recordOpsError(supabaseAdmin, 'match', matchId, 'steam_id_learn', `Learn steam id failed: ${(err as Error).message}`);
        }
      })(),
    ]);
  };

  if (opts.after) opts.after(runHooks);
  else await runHooks();

  return { ok: true };
}
