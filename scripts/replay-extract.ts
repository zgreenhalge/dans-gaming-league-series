// `replay-extract` job entry point — runs in the GitHub Action (Action A) via `tsx`.
//
// demo (R2) → buildReplay() → gzipped replay.json (R2 `<matchId>/replay.json`).
// Reuses the SAME `src/lib/replay/*` code as the app, so there is no logic drift.
//
// Observability: each named stage is reported two ways (issue #121) —
//   1. collapsible GitHub log groups + ::notice/::warning/::error annotations, and
//   2. `background_jobs.stage`, so the app can show progress without opening Actions.
//
// Env (from the workflow): MATCH_ID, GH_RUN_ID, GH_RUN_URL, plus R2 creds and
// SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL (GH Actions secrets).

import { gzipSync } from 'node:zlib';
import { getReplayInputs } from '../src/lib/replay/inputs';
import { buildReplay } from '../src/lib/replay/extract';
import { buildHeatmapPoints } from '../src/lib/replay/heatmap';
import { getR2Object, putR2Object, demoKey, replayKey, heatmapKey } from '../src/lib/r2';
import { gunzipMaybe } from '../src/lib/gzip';
import { getAdminClient } from '../src/lib/supabase-admin';
import { recordJobStatus, matchJobKey, jobStatusWriter } from '../src/lib/background-jobs';

const JOB_TYPE = 'replay_extract';

const STAGES = [
  'validate',
  'download-demo',
  'decompress',
  'parse-ticks',
  'parse-events',
  'parse-grenades',
  'assemble',
  'gzip',
  'upload',
  'heatmap',
  'done',
] as const;

const matchId = Number(process.env.MATCH_ID);
const ghRunId = process.env.GH_RUN_ID ? Number(process.env.GH_RUN_ID) : null;
const ghRunUrl = process.env.GH_RUN_URL ?? null;
const supabase = getAdminClient();

let currentStage: string = STAGES[0];

function notice(msg: string) {
  console.log(`::notice::${msg}`);
}
function warning(msg: string) {
  console.log(`::warning::${msg}`);
}

/** Every non-terminal write in this script (running/stage/succeeded) goes through this one choke
 *  point; `fail()` below writes directly instead, since it must not throw while already unwinding. */
const setJob = jobStatusWriter(supabase, JOB_TYPE, matchJobKey(matchId));

/** Mark the row queued→running (idempotent), recording the GH run link. */
async function markRunning() {
  await setJob({
    status: 'running',
    stage: STAGES[0],
    error_message: null,
    gh_run_id: ghRunId,
    gh_run_url: ghRunUrl,
    started_at: new Date().toISOString(),
  });
  await supabase
    .from('matches')
    .update({ replay_status: 'running' })
    .eq('id', matchId)
    .throwOnError();
}

async function setStage(stage: string) {
  currentStage = stage;
  await setJob({ stage });
}

/** Run a named stage inside a collapsible GH log group, reporting it to the DB. */
async function stage<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  console.log(`::group::${name}`);
  notice(`stage ${name}`);
  await setStage(name);
  try {
    return await fn();
  } finally {
    console.log('::endgroup::');
  }
}

async function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`::error::failed at stage ${currentStage}: ${msg}`);
  await recordJobStatus(supabase, JOB_TYPE, matchJobKey(matchId), {
    status: 'failed',
    stage: currentStage,
    error_message: msg,
    finished_at: new Date().toISOString(),
  });
  await supabase.from('matches').update({ replay_status: 'failed' }).eq('id', matchId);
  process.exit(1);
}

async function main() {
  if (!Number.isFinite(matchId)) throw new Error('MATCH_ID env var missing or invalid');
  await markRunning();

  const inputs = await stage('validate', async () => {
    const i = await getReplayInputs(supabase, matchId);
    if (!i.map) warning('Match has no map name — auto-fit playback only.');
    return i;
  });

  let demoBuffer = await stage('download-demo', async () => {
    const buf = await getR2Object(demoKey(matchId));
    if (!buf) throw new Error('Demo not found in R2 — upload a demo first.');
    return buf;
  });

  demoBuffer = await stage('decompress', () => gunzipMaybe(demoBuffer));

  // buildReplay() does parse-ticks → parse-events → parse-grenades → assemble in one
  // pass; we surface those as ordered stages around it for progress reporting.
  await setStage('parse-ticks');
  const { payload, warnings, notices } = await stage('assemble', () => {
    notice('parsing ticks, events, and grenades');
    return buildReplay({
      demoBuffer,
      matchId,
      map: inputs.map,
      roster: inputs.roster,
      skinsSide: inputs.skinsSide,
      targetWinRounds: inputs.targetWinRounds,
      includeKnifeRound: inputs.isGauntlet,
    });
  });
  for (const n of notices) notice(n);
  for (const w of warnings) warning(w);

  const gz = await stage('gzip', () => gzipSync(Buffer.from(JSON.stringify(payload))));
  notice(`replay.json: ${payload.rounds.length} rounds, ${gz.length} bytes gzipped`);

  await stage('upload', () =>
    putR2Object(replayKey(matchId), gz, {
      contentType: 'application/json',
      contentEncoding: 'gzip',
    }),
  );

  // Compact heatmap points artifact (kills/deaths/grenades) for the map's Heatmap
  // tab — derived from the same payload, so there's no second source of truth.
  await stage('heatmap', async () => {
    const points = buildHeatmapPoints(payload);
    const gzPoints = gzipSync(Buffer.from(JSON.stringify(points)));
    notice(`heatmap.json: ${points.points.length} points, ${gzPoints.length} bytes gzipped`);
    await putR2Object(heatmapKey(matchId), gzPoints, {
      contentType: 'application/json',
      contentEncoding: 'gzip',
    });
  });

  await stage('done', async () => {
    await setJob({
      status: 'succeeded',
      stage: 'done',
      error_message: null,
      finished_at: new Date().toISOString(),
    });
    await supabase
      .from('matches')
      .update({ replay_status: 'ready' })
      .eq('id', matchId)
      .throwOnError();
  });

  notice('replay-extract complete');
}

main().catch(fail);
