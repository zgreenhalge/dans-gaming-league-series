// `demo-ingest` job entry point — runs in the GitHub Action via `tsx`. Phase 3 of the DatHost +
// MatchZy initiative (manual-confirm; auto-commit is issue #138).
//
// demo (R2) → parseDemoFile + parseDemoSabremetrics (via getReplayInputs) → quarantine check →
// stage a confirm-ready result at `demoResultKey` (R2, gzipped JSON). The in-match review block reads
// it and the human confirms via the existing `PATCH /score`. Heavy parsing runs HERE, not on Vercel
// (kills the parse route's MAX_DEMO_BYTES ceiling). Mirrors `replay-extract.ts`.
//
// Reparsing an already-confirmed match (e.g. to backfill fields from a newly added collector) skips
// the staged-review step: when the freshly derived score matches the match's existing `final_score`,
// the sabremetrics are upserted directly and the job is marked `confirmed`. A derived score that
// differs from the stored one always falls through to the normal staged-result review instead, so a
// reparse can never silently rewrite an already-agreed result.
//
// Env (from the workflow): MATCH_ID, GH_RUN_ID, GH_RUN_URL, R2 creds, SUPABASE_SERVICE_ROLE_KEY /
// NEXT_PUBLIC_SUPABASE_URL. Storage is schema-free: background_jobs.status + the R2 artifact.

import { gzipSync } from 'node:zlib';
import { parseDemoFile } from '../src/lib/demoParser';
import { parseDemoSabremetrics } from '../src/lib/demoOrchestrator';
import { getReplayInputs } from '../src/lib/replay/inputs';
import { quarantineDemo } from '../src/lib/demo/quarantine';
import { getR2Object, putR2Object, deleteR2Object, demoKey, demoResultKey } from '../src/lib/r2';
import { getAdminClient } from '../src/lib/supabase-admin';
import { gunzipMaybe } from '../src/lib/gzip';
import { isPlayedScore, parseScore } from '../src/lib/util';
import { persistSabremetrics } from '../src/lib/demo/sabremetrics';
import { DEMO_INGEST_JOB_TYPE as JOB_TYPE, type DemoIngestResult } from '../src/lib/demo/ingestResult';

const matchId = Number(process.env.MATCH_ID);
const ghRunId = process.env.GH_RUN_ID ? Number(process.env.GH_RUN_ID) : null;
const ghRunUrl = process.env.GH_RUN_URL ?? null;
const supabase = getAdminClient();

function notice(msg: string) {
  console.log(`::notice::${msg}`);
}

/** Upsert the job row (it normally exists from the notify route; upsert covers manual runs too). */
async function setJob(fields: Record<string, unknown>) {
  await supabase.from('background_jobs').upsert(
    { job_type: JOB_TYPE, match_id: matchId, updated_at: new Date().toISOString(), ...fields },
    { onConflict: 'job_type,match_id' },
  );
}

async function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.log(`::error::demo-ingest failed: ${message}`);
  await setJob({ status: 'failed', stage: 'error', error_message: message, finished_at: new Date().toISOString() });
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

  // Reparse of an already-confirmed match with an unchanged score: apply the refreshed sabremetrics
  // directly, no staged review needed.
  if (q.ok && parsed.shirts_score !== null && parsed.skins_score !== null) {
    const { data: matchRow } = await supabase
      .from('matches')
      .select('final_score')
      .eq('id', matchId)
      .maybeSingle();
    const existingScore = (matchRow as { final_score: string | null } | null)?.final_score ?? null;
    const existing = isPlayedScore(existingScore) ? parseScore(existingScore) : null;

    if (existing && existing.shirts === parsed.shirts_score && existing.skins === parsed.skins_score) {
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
  }

  // Confirm-ready payload only when the side was known and the score derived (regular season).
  // Null → gauntlet/knife: the review block routes it to manual side-entry (issue #137).
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
