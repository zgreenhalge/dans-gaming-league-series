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
// `AUTO_COMMIT_ENABLED=true` gates the actual write; unset runs the predicate in shadow mode —
// evaluated and logged, still staged for manual confirm — so it can be watched on real matches
// before it's trusted to write.
//
// Reparsing an already-confirmed match (e.g. to backfill fields from a newly added collector) skips
// both auto-commit and the staged-review step: when the freshly derived score matches the match's
// existing `final_score`, the sabremetrics are upserted directly and the job is marked `confirmed`. A
// derived score that differs from the stored one is exactly what the D5 predicate's `alreadyPlayed`
// check excludes — it always falls through to the staged-result review instead, regardless of how
// cleanly the new parse corroborates against `map_result`.
//
// Env (from the workflow): MATCH_ID, GH_RUN_ID, GH_RUN_URL, R2 creds, SUPABASE_SERVICE_ROLE_KEY /
// NEXT_PUBLIC_SUPABASE_URL, AUTO_COMMIT_ENABLED, APP_BASE_URL + RECOMPUTE_SECRET (for the EHOG
// recompute an auto-commit triggers). Storage is schema-free: background_jobs.status + R2 artifacts.

import { gzipSync } from 'node:zlib';
import { parseDemoFile } from '../src/lib/demoParser';
import { parseDemoSabremetrics } from '../src/lib/demoOrchestrator';
import { getReplayInputs } from '../src/lib/replay/inputs';
import { quarantineDemo } from '../src/lib/demo/quarantine';
import { getR2Object, putR2Object, deleteR2Object, demoKey, demoResultKey, mapResultKey } from '../src/lib/r2';
import { getMapResult } from '../src/lib/demo/mapResult';
import { evaluateAutoCommit } from '../src/lib/demo/autoCommit';
import { getAdminClient } from '../src/lib/supabase-admin';
import { gunzipMaybe } from '../src/lib/gzip';
import { isPlayedScore, parseScore } from '../src/lib/util';
import { persistSabremetrics } from '../src/lib/demo/sabremetrics';
import { writeMatchScore } from '../src/lib/matchScore';
import { DEMO_INGEST_JOB_TYPE as JOB_TYPE, type DemoIngestResult } from '../src/lib/demo/ingestResult';
import { recordJobStatus, matchJobKey, jobStatusWriter } from '../src/lib/background-jobs';
import { notice, error } from './gh-actions-log';

const matchId = Number(process.env.MATCH_ID);
const ghRunId = process.env.GH_RUN_ID ? Number(process.env.GH_RUN_ID) : null;
const ghRunUrl = process.env.GH_RUN_URL ?? null;
const supabase = getAdminClient();

/** Upsert the job row (it normally exists from the notify route; upsert covers manual runs too).
 *  Throws if the write fails, so a corrupted status row aborts the run via `main().catch(fail)`
 *  rather than leaving the row stuck at its last-written status looking like a hang; `fail()` below
 *  writes directly instead, since it must not throw while already unwinding. */
const setJob = jobStatusWriter(supabase, JOB_TYPE, matchJobKey(matchId));

async function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  error(`demo-ingest failed: ${message}`);
  await recordJobStatus(supabase, JOB_TYPE, matchJobKey(matchId), {
    status: 'failed',
    stage: 'error',
    error_message: message,
    finished_at: new Date().toISOString(),
  });
  process.exit(1);
}

async function main() {
  if (!Number.isInteger(matchId) || matchId <= 0) throw new Error(`Bad MATCH_ID: ${process.env.MATCH_ID}`);

  await setJob({
    status: 'running',
    stage: 'parse',
    error_message: null,
    gh_run_id: ghRunId,
    gh_run_url: ghRunUrl,
    started_at: new Date().toISOString(),
  });

  const inputs = await getReplayInputs(supabase, matchId);

  const raw = await getR2Object(demoKey(matchId));
  if (!raw) throw new Error(`No demo in R2 at ${demoKey(matchId)}`);
  const demo = gunzipMaybe(raw);

  const parsed = parseDemoFile(demo, inputs.roster, inputs.skinsSide, inputs.targetWinRounds);
  const sab = parseDemoSabremetrics(demo, inputs.roster, inputs.skinsSide, inputs.targetWinRounds);
  const warnings = [...new Set([...parsed.warnings, ...sab.warnings])];

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

    if (decision.eligible && process.env.AUTO_COMMIT_ENABLED === 'true') {
      const written = await writeMatchScore(supabase, matchId, {
        shirts: payload.shirts,
        skins: payload.skins,
        player_stats: payload.player_stats,
        sabremetrics: payload.sabremetrics,
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
        `demo-ingest match ${matchId}: would auto-commit ${payload.shirts}-${payload.skins} (shadow mode — set AUTO_COMMIT_ENABLED=true to go live) — staging for manual confirm`,
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

main().catch(fail);
