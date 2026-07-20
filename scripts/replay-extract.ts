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
import { buildHeatmapPoints, MAP_HEATMAP_ROLLUP_VERSION } from '../src/lib/replay/heatmap';
import { buildMatchTraces, MAP_TRACE_ROLLUP_VERSION } from '../src/lib/replay/aggregate';
import {
  getR2Object,
  putR2Object,
  demoKey,
  replayKey,
  heatmapKey,
  traceKey,
  mapHeatmapKey,
  mapTraceKey,
} from '../src/lib/r2';
import { gunzipMaybe } from '../src/lib/gzip';
import { getAdminClient } from '../src/lib/supabase-admin';
import { getMatchIdsForMap, getMapHeatmap, heatmapArtifactToPoints } from '../src/lib/queries/maps';
import { getMapTraces, matchTraceArtifactToEntries } from '../src/lib/queries/replay';
import { mapSlug } from '../src/lib/maps';

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
  'traces',
  'map-rollup',
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

/** Mark the row queued→running (idempotent), recording the GH run link. */
async function markRunning() {
  await supabase
    .from('background_jobs')
    .upsert(
      {
        job_type: JOB_TYPE,
        match_id: matchId,
        status: 'running',
        stage: STAGES[0],
        error_message: null,
        gh_run_id: ghRunId,
        gh_run_url: ghRunUrl,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'job_type,match_id' },
    )
    .throwOnError();
  await supabase
    .from('matches')
    .update({ replay_status: 'running' })
    .eq('id', matchId)
    .throwOnError();
}

async function setStage(stage: string) {
  currentStage = stage;
  await supabase
    .from('background_jobs')
    .update({ stage, updated_at: new Date().toISOString() })
    .eq('job_type', JOB_TYPE)
    .eq('match_id', matchId)
    .throwOnError();
}

/** Gzip a JSON-serializable value and upload it, returning the gzipped byte length for logging. */
async function uploadGzippedJson(key: string, data: unknown): Promise<number> {
  const gz = gzipSync(Buffer.from(JSON.stringify(data)));
  await putR2Object(key, gz, { contentType: 'application/json', contentEncoding: 'gzip' });
  return gz.length;
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
  await supabase
    .from('background_jobs')
    .update({
      status: 'failed',
      stage: currentStage,
      error_message: msg,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('job_type', JOB_TYPE)
    .eq('match_id', matchId);
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
  const heatmapArtifact = await stage('heatmap', async () => {
    const artifact = buildHeatmapPoints(payload);
    const bytes = await uploadGzippedJson(heatmapKey(matchId), artifact);
    notice(`heatmap.json: ${artifact.points.length} points, ${bytes} bytes gzipped`);
    return artifact;
  });

  // Compact per-player trace artifact (issue #127) for the player page's Pathing tab —
  // same reasoning as heatmap.json: derived from the same payload, no second source
  // of truth, and much smaller than replay.json since it carries positions only.
  const traceArtifact = await stage('traces', async () => {
    const artifact = buildMatchTraces(payload);
    const bytes = await uploadGzippedJson(traceKey(matchId), artifact);
    notice(`traces.json: ${artifact.players.length} players, ${bytes} bytes gzipped`);
    return artifact;
  });

  // Rebuild this map's heatmap + trace rollups (issue #127) — precomputed merges of
  // every match on the map, read by the map page / Scouting Report / player Pathing
  // tab instead of fanning out one R2 GET per match on every open. Always a *full*
  // rebuild from the per-match artifacts (never an incremental patch), so it's
  // idempotent and self-healing: concurrent extracts for other matches on the same
  // map (e.g. a `replay-extract-all` backfill) may race and overwrite each other, but
  // each writer computes a fully-correct rollup for whatever's already in R2 at that
  // moment, and every match's own extract rebuilds again on its way to `ready` — so
  // the map converges to complete without any locking. Fail-soft: a hiccup here must
  // never fail this match's own (already-successful) replay, so it's a warning, not
  // a thrown error — matching `radar-build`'s own best-effort/isolated sub-steps.
  await stage('map-rollup', async () => {
    const slug = payload.map ? mapSlug(payload.map) : null;
    if (!slug) {
      warning('Match has no map name — skipping map rollup rebuild.');
      return;
    }
    try {
      const mapMatchIds = await getMatchIdsForMap(payload.map, supabase);
      // This match's own points/entries are already in memory from the stages above —
      // no need to re-read what was just written. Only fan out over the rest.
      const otherMatchIds = mapMatchIds.filter((id) => id !== matchId);

      const [otherPoints, otherEntries] = await Promise.all([
        getMapHeatmap(otherMatchIds),
        getMapTraces(otherMatchIds),
      ]);
      const points = [...heatmapArtifactToPoints(matchId, heatmapArtifact), ...otherPoints];
      const entries = [...matchTraceArtifactToEntries(traceArtifact), ...otherEntries];

      const [heatmapBytes, traceBytes] = await Promise.all([
        uploadGzippedJson(mapHeatmapKey(slug), {
          version: MAP_HEATMAP_ROLLUP_VERSION,
          slug,
          matchIds: mapMatchIds,
          points,
        }),
        uploadGzippedJson(mapTraceKey(slug), {
          version: MAP_TRACE_ROLLUP_VERSION,
          slug,
          matchIds: mapMatchIds,
          entries,
        }),
      ]);

      notice(
        `map rollups for "${slug}": ${mapMatchIds.length} matches, ${points.length} heatmap points ` +
          `(${heatmapBytes}B), ${entries.length} trace entries (${traceBytes}B)`,
      );
    } catch (err) {
      warning(`map rollup rebuild failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  await stage('done', async () => {
    await supabase
      .from('background_jobs')
      .update({
        status: 'succeeded',
        stage: 'done',
        error_message: null,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('job_type', JOB_TYPE)
      .eq('match_id', matchId)
      .throwOnError();
    await supabase
      .from('matches')
      .update({ replay_status: 'ready' })
      .eq('id', matchId)
      .throwOnError();
  });

  notice('replay-extract complete');
}

main().catch(fail);
