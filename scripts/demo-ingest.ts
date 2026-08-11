// `demo-ingest` job entry point — runs in the GitHub Action via `tsx`. Phase 3 (manual-confirm) +
// Phase 5 (trusted auto-commit, #138) of the DatHost + MatchZy initiative.
//
// demo (R2) → parseDemoFile + parseDemoSabremetrics (via getReplayInputs) → quarantine check →
// either auto-commit (writeMatchScore, D5 predicate) or stage a confirm-ready result at
// `demoResultKey` (R2, gzipped JSON) for the in-match review block's human Confirm. Heavy parsing
// runs HERE, not on Vercel (kills the parse route's MAX_DEMO_BYTES ceiling). Mirrors
// `replay-extract.ts`.
//
// Auto-commit predicate (D5, `evaluateAutoCommit` in `src/lib/demo/autoCommit.ts`) — ALL must hold,
// else fall back to the staged-result review: the match has no existing confirmed score, quarantine
// passes, zero parser warnings (also covers full roster resolution: an unresolved player throws
// before this point, and a stored-vs-demo side disagreement pushes a warning), `skins_starting_side`
// was STORED rather than just demo-inferred (excludes the gauntlet knife path — #137's self-derived
// score always has a payload, but never a stored side — always manual review), and the demo-derived
// score matches MatchZy's own `map_result` remote-log event (the independent cross-check;
// `buildMatchzyConfig` fixes team1 = SHIRTS, team2 = SKINS, so it's direct equality).
// The write itself is gated on `AUTO_COMMIT_ENABLED !== 'false'` — auto-commit is on by default;
// setting the repo Actions variable to `false` is the manual override, forcing every eligible match
// through the staged-result review instead (e.g. while investigating a parser issue).
//
// Reparsing an already-confirmed match (e.g. to backfill fields from a newly added collector) skips
// both auto-commit and the staged-review step: when the freshly derived score matches the match's
// existing `final_score`, the sabremetrics are upserted directly and the job is marked `confirmed`. A
// derived score that differs from the stored one is exactly what the D5 predicate's `alreadyPlayed`
// check excludes — it always falls through to the staged-result review instead, regardless of how
// cleanly the new parse corroborates against `map_result`.
//
// The demo itself is pulled directly from the DatHost game server's file storage (not pushed by
// MatchZy — see `fetchFromDathost.ts` for why) at the very start of the run, if it isn't already in R2.
//
// Env (from the workflow): MATCH_ID, GH_RUN_ID, GH_RUN_URL, R2 creds, SUPABASE_SERVICE_ROLE_KEY /
// NEXT_PUBLIC_SUPABASE_URL, AUTO_COMMIT_ENABLED, APP_BASE_URL + RECOMPUTE_SECRET (for the EHOG
// recompute an auto-commit triggers), DATHOST_EMAIL/DATHOST_PASSWORD/DATHOST_SERVER_ID (for the demo
// pull). Storage is schema-free: background_jobs.status + R2 artifacts.

import { gzipSync } from 'node:zlib';
import { parseDemoFile } from '../src/lib/demoParser';
import { parseDemoSabremetrics } from '../src/lib/demoOrchestrator';
import { getReplayInputs } from '../src/lib/replay/inputs';
import { demoBaseName } from '../src/lib/matchzy';
import { quarantineDemo } from '../src/lib/demo/quarantine';
import { putR2Object, deleteR2Object, demoResultKey, mapResultKey } from '../src/lib/r2';
import { getMapResult } from '../src/lib/demo/mapResult';
import { pullDemoAndClearLiveScore } from '../src/lib/demo/liveScore';
import { demoIngestFlushFloorMs } from '../src/lib/demo/flushFloor';
import { dathostServerId } from '../src/lib/dathost';
import { evaluateAutoCommit } from '../src/lib/demo/autoCommit';
import { getAdminClient } from '../src/lib/supabase-admin';
import { gunzipMaybe } from '../src/lib/gzip';
import { isPlayedScore, parseScore } from '../src/lib/util';
import { persistSabremetrics } from '../src/lib/demo/sabremetrics';
import { persistWeaponStats } from '../src/lib/demo/weaponStats';
import { writeMatchScore } from '../src/lib/matchScore';
import { DEMO_INGEST_JOB_TYPE as JOB_TYPE, type DemoIngestResult } from '../src/lib/demo/ingestResult';
import { matchJobKey } from '../src/lib/background-jobs';
import { notice } from './gh-actions-log';
import { createJobRunner } from './job-stage';

const STAGES = ['fetch', 'parse'] as const;

const matchId = Number(process.env.MATCH_ID);
const supabase = getAdminClient();

/** `runner.markRunning()` upserts the job row (it normally exists from the matchzy-log route; upsert
 *  covers manual runs too) and throws if the write fails, so a corrupted status row aborts the run via
 *  `main().catch(runner.fail)` rather than leaving the row stuck at its last-written status looking
 *  like a hang; `runner.fail` below writes directly instead, since it must not throw while already
 *  unwinding. */
const runner = createJobRunner(supabase, JOB_TYPE, matchJobKey(matchId), STAGES[0]);
const { stage, setJob } = runner;

async function main() {
  if (!Number.isInteger(matchId) || matchId <= 0) throw new Error(`Bad MATCH_ID: ${process.env.MATCH_ID}`);

  await runner.markRunning();

  // Pulls the demo from DatHost if it isn't already in R2 (a manual reparse of an already-staged/
  // confirmed match has it already). Reads the match's inputs first (cheap) so it can poll the same
  // deterministic path buildMatchzyConfig set as the matchzy_demo_name_format cvar — see
  // demoBaseName()'s doc comment. Inside the stage() wrapper (not before it) so a failure either way
  // still gets the stage's log group/notice and reports stage: 'fetch'.
  const { inputs, raw } = await stage('fetch', async () => {
    const inputs = await getReplayInputs(supabase, matchId);
    const baseName = demoBaseName(matchId, inputs.scheduledAt, inputs.map);
    const raw = await pullDemoAndClearLiveScore(supabase, dathostServerId(), matchId, baseName, {
      getFlushFloorMs: () => demoIngestFlushFloorMs(supabase, matchId),
    });
    return { inputs, raw };
  });

  const { parsed, sab, warnings } = await stage('parse', async () => {
    const demo = gunzipMaybe(raw);

    const parsed = parseDemoFile(demo, inputs.roster, inputs.skinsSide, inputs.targetWinRounds);
    const sab = parseDemoSabremetrics(demo, inputs.roster, inputs.skinsSide, inputs.targetWinRounds);
    const warnings = [...new Set([...parsed.warnings, ...sab.warnings])];
    return { parsed, sab, warnings };
  });

  const q = quarantineDemo({
    roundHistory: parsed.round_history,
    shirtsScore: parsed.shirts_score,
    skinsScore: parsed.skins_score,
    targetWinRounds: inputs.targetWinRounds,
  });

  // The match's existing confirmed score, if any — shared by the reparse shortcut below and the D5
  // predicate's `alreadyPlayed` check (auto-commit never overwrites a played match).
  const { data: matchRow } = await supabase.from('matches').select('final_score').eq('id', matchId).maybeSingle();
  const existingScore = (matchRow as { final_score: string | null } | null)?.final_score ?? null;
  const existing = isPlayedScore(existingScore) ? parseScore(existingScore) : null;

  // Reparse of an already-confirmed match with an unchanged score: apply the refreshed sabremetrics
  // directly, no staged review needed.
  if (
    q.ok &&
    parsed.shirts_score !== null &&
    parsed.skins_score !== null &&
    existing &&
    existing.shirts === parsed.shirts_score &&
    existing.skins === parsed.skins_score
  ) {
    await persistSabremetrics(matchId, sab.sabremetrics);
    await persistWeaponStats(matchId, sab.weaponStats);
    await deleteR2Object(demoResultKey(matchId));
    await setJob({
      status: 'confirmed',
      stage: 'confirmed',
      error_message: null,
      finished_at: new Date().toISOString(),
    });
    notice(
      `demo-ingest match ${matchId}: reparsed, score unchanged (${parsed.shirts_score}-${parsed.skins_score}) — sabremetrics auto-confirmed`,
    );
    return;
  }

  // Confirm-ready payload whenever a score derived — including gauntlet/knife matches, which
  // self-derive via demo-side inference (#137). Only null on a genuinely undecidable demo.
  const payload =
    parsed.shirts_score !== null && parsed.skins_score !== null
      ? {
          shirts: parsed.shirts_score,
          skins: parsed.skins_score,
          player_stats: parsed.stats.map((s) => ({
            player_id: s.player_id,
            kills: s.kills,
            assists: s.assists,
            deaths: s.deaths,
            damage: s.damage,
            adr: s.adr,
          })),
          sabremetrics: sab.sabremetrics,
          weaponStats: sab.weaponStats,
          round_history: parsed.round_history,
        }
      : null;

  // Trusted auto-commit (#138): a clean, corroborated parse skips the human Confirm. Roster
  // resolution is already guaranteed here — an unresolved demo player throws inside parseDemoFile,
  // well before this point — so the D5 predicate only needs to check what's left.
  if (payload !== null) {
    const mapResult = await getMapResult(matchId);
    const decision = evaluateAutoCommit({
      quarantinePassed: q.ok,
      warningCount: warnings.length,
      skinsSideStored: inputs.skinsSide !== null,
      alreadyPlayed: existing !== null,
      derived: { shirts: payload.shirts, skins: payload.skins },
      mapResult: mapResult ? { shirts: mapResult.team1.score, skins: mapResult.team2.score } : null,
    });

    if (decision.eligible && process.env.AUTO_COMMIT_ENABLED !== 'false') {
      const written = await writeMatchScore(supabase, matchId, {
        shirts: payload.shirts,
        skins: payload.skins,
        player_stats: payload.player_stats,
        sabremetrics: payload.sabremetrics,
        weaponStats: payload.weaponStats,
        round_history: payload.round_history,
      });
      if (written.ok) {
        await Promise.all([deleteR2Object(demoResultKey(matchId)), deleteR2Object(mapResultKey(matchId))]);
        await setJob({
          status: 'confirmed',
          stage: 'confirmed',
          error_message: null,
          finished_at: new Date().toISOString(),
        });
        notice(
          `demo-ingest match ${matchId}: auto-committed ${payload.shirts}-${payload.skins} (D5 predicate passed, corroborated by map_result)`,
        );
        return;
      }
      notice(
        `demo-ingest match ${matchId}: auto-commit predicate passed but the write failed (${written.error}) — falling back to staged review`,
      );
    } else if (decision.eligible) {
      notice(
        `demo-ingest match ${matchId}: would auto-commit ${payload.shirts}-${payload.skins} (AUTO_COMMIT_ENABLED=false — manual override active) — staging for manual confirm`,
      );
    } else {
      notice(`demo-ingest match ${matchId}: not auto-committing (${decision.reason}) — staging for manual confirm`);
    }
  }

  const result: DemoIngestResult = {
    matchId,
    generatedAt: new Date().toISOString(),
    payload,
    warnings,
    quarantined: !q.ok,
    quarantineFlags: q.flags,
  };

  await putR2Object(demoResultKey(matchId), gzipSync(Buffer.from(JSON.stringify(result))), {
    contentType: 'application/json',
    contentEncoding: 'gzip',
  });

  const status = q.ok ? 'parsed' : 'quarantined';
  await setJob({ status, stage: status, error_message: null, finished_at: new Date().toISOString() });
  notice(
    `demo-ingest match ${matchId}: ${status}; score ${payload ? `${payload.shirts}-${payload.skins}` : 'underived'}; ` +
      `${warnings.length} warning(s); ${q.flags.length} quarantine flag(s)`,
  );
}

main().catch(runner.fail);
