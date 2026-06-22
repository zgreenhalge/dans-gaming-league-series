// `radar-build` job entry point — runs in the GitHub Action (Action B) via `tsx`.
//
// workshop map (Steam) → top-down radar PNG + calibration → R2 `maps/<id>/radar.png`
// + the `maps` row's radar_* columns. This is the one pipeline that shells out to
// external tools, so it is fully isolated: if it fails, the map simply stays
// uncalibrated and the replay/heatmap fall back to auto-fit — it never blocks
// playback. See `docs/replay.md`.
//
// The deterministic parsing (overview offset/scale, workshop id) lives in
// `src/lib/replay/radar.ts` and is unit-tested; the SteamCMD download + VPK extract +
// .vtex_c decode below are best-effort orchestration whose first real run validates
// the exact tool invocations (mirrors the extract Action's field-name validation).
//
// Env (from the workflow): MAP_ID, GH_RUN_ID, GH_RUN_URL, STEAMCMD (path), DECOMPILER
// (Source2Viewer CLI path), plus R2 creds + Supabase service key.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseOverview, workshopIdFromUrl } from '../src/lib/replay/radar';
import { putR2Object, radarKey } from '../src/lib/r2';
import { getAdminClient } from '../src/lib/supabase-admin';

const JOB_TYPE = 'radar_build';

const STAGES = [
  'validate-workshop-id',
  'steamcmd-download',
  'extract-vpk',
  'decode-vtex',
  'compute-calibration',
  'upload-radar',
  'upsert-map',
  'done',
] as const;

const mapId = Number(process.env.MAP_ID);
const ghRunId = process.env.GH_RUN_ID ? Number(process.env.GH_RUN_ID) : null;
const ghRunUrl = process.env.GH_RUN_URL ?? null;
const STEAMCMD = process.env.STEAMCMD || 'steamcmd';
const DECOMPILER = process.env.DECOMPILER || 'Source2Viewer-CLI';
const supabase = getAdminClient();

let currentStage: string = STAGES[0];
// Human-facing label for this run — replaced with the map name as soon as we resolve
// it (map ids aren't used forward-facing, so every log/summary line leads with name).
let mapLabel = `map #${mapId}`;

const notice = (m: string) => console.log(`::notice::${m}`);
const warning = (m: string) => console.log(`::warning::${m}`);

/** Append markdown to the GitHub run summary (the panel at the top of the run page). */
function summary(md: string) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, md + '\n');
}

async function markRunning() {
  const now = new Date().toISOString();
  await supabase
    .from('background_jobs')
    .upsert(
      {
        job_type: JOB_TYPE,
        map_id: mapId,
        status: 'running',
        stage: STAGES[0],
        error_message: null,
        gh_run_id: ghRunId,
        gh_run_url: ghRunUrl,
        started_at: now,
        updated_at: now,
      },
      { onConflict: 'job_type,map_id' },
    )
    .throwOnError();
}

async function setStage(stage: string) {
  currentStage = stage;
  await supabase
    .from('background_jobs')
    .update({ stage, updated_at: new Date().toISOString() })
    .eq('job_type', JOB_TYPE)
    .eq('map_id', mapId)
    .throwOnError();
}

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
  console.log(`::error::${mapLabel} failed at stage ${currentStage}: ${msg}`);
  summary(`\n❌ **${mapLabel}** failed at \`${currentStage}\`: ${msg}`);
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
    .eq('map_id', mapId);
  process.exit(1);
}

/** Recursively collect files under `dir` whose path matches `test`. */
function walk(dir: string, test: (path: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, test, out);
    else if (test(full)) out.push(full);
  }
  return out;
}

async function main() {
  if (!Number.isFinite(mapId)) throw new Error('MAP_ID env var missing or invalid');
  await markRunning();

  const { workshopId, mapName } = await stage('validate-workshop-id', async () => {
    const { data } = await supabase
      .from('maps')
      .select('id, name, slug, workshop_url')
      .eq('id', mapId)
      .maybeSingle();
    const row = data as { name: string; slug: string; workshop_url: string | null } | null;
    if (!row) throw new Error(`Map ${mapId} not found`);
    mapLabel = `${row.name} (#${mapId})`;
    const id = workshopIdFromUrl(row.workshop_url);
    if (!id) throw new Error(`${mapLabel} has no usable workshop_url`);
    // Lead with the map name everywhere a human looks: the run summary panel and a
    // banner notice (map ids aren't meaningful forward-facing).
    summary(`## 🗺️ radar-build — ${row.name}\n\n- Map: **${row.name}** (\`${row.slug}\`, id ${mapId})\n- Workshop item: ${id}\n`);
    notice(`▶ Building radar for "${row.name}"  ·  slug ${row.slug}  ·  workshop ${id}`);
    return { workshopId: id, mapName: row.name };
  });

  const contentDir = await stage('steamcmd-download', () => {
    // Anonymous workshop download of the CS2 (appid 730) item. Capture stdout so we
    // can read the destination SteamCMD prints — its Steam root varies by install
    // (the apt build uses ~/.local/share/Steam, not ~/Steam).
    const out = execFileSync(
      STEAMCMD,
      ['+login', 'anonymous', '+workshop_download_item', '730', workshopId, '+quit'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 },
    );
    process.stdout.write(out);
    if (!/Success\.\s*Downloaded item/i.test(out)) {
      // Some items can't be fetched anonymously; SteamCMD exits 0 either way.
      throw new Error('SteamCMD did not report a successful download (item may not be public)');
    }
    const printed = out.match(/Downloaded item \d+ to "([^"]+)"/i);
    const candidates = [
      ...(printed ? [printed[1]] : []),
      ...['.local/share/Steam', 'Steam', '.steam/steam', '.steam/SteamApps'].map((root) =>
        join(homedir(), root, 'steamapps', 'workshop', 'content', '730', workshopId),
      ),
    ];
    const dir = candidates.find((p) => existsSync(p));
    if (!dir) {
      throw new Error(`Workshop content dir not found (checked: ${candidates.join(', ')})`);
    }
    notice(`workshop content at ${dir}`);
    return dir;
  });

  const vpk = await stage('extract-vpk', () => {
    const vpks = walk(contentDir, (p) => p.toLowerCase().endsWith('.vpk'));
    if (vpks.length === 0) throw new Error('No .vpk found in the workshop download');
    // Prefer the directory pak (`*_dir.vpk`) — Source2Viewer needs the index, not a
    // raw data chunk. Otherwise the largest .vpk (usually a single-file map pak).
    const dirPak = vpks.find((p) => /_dir\.vpk$/i.test(p));
    return dirPak ?? vpks.sort((a, b) => statSync(b).size - statSync(a).size)[0];
  });

  const outDir = join(process.cwd(), 'radar-out');
  await stage('decode-vtex', () => {
    // Source2Viewer CLI decompiles the pak, turning .vtex_c radar textures into PNGs
    // and writing the plain overview .txt. Flags are best-effort; the first run
    // validates them. A choke here is recoverable — the map stays uncalibrated.
    execFileSync(DECOMPILER, ['-i', vpk, '-o', outDir, '-d', '-e', 'vtex_c'], {
      stdio: 'inherit',
    });
    execFileSync(DECOMPILER, ['-i', vpk, '-o', outDir, '-d', '-e', 'txt'], { stdio: 'inherit' });
  });

  const calibration = await stage('compute-calibration', () => {
    const overviews = walk(
      outDir,
      (p) => /overviews?[\\/].*\.txt$/i.test(p) && !/\.vtex/i.test(p),
    );
    if (overviews.length === 0) {
      throw new Error('No resource/overviews/<map>.txt found — cannot calibrate from VPK');
    }
    // Prefer an overview whose name matches the map; else take the first.
    const slug = mapName.toLowerCase().replace(/\s+/g, '_');
    const matched = overviews.find((p) => p.toLowerCase().includes(slug));
    const chosen = matched ?? overviews[0];
    if (!matched) {
      warning(`No overview matched map slug "${slug}"; using ${chosen} (verify the radar).`);
    }
    const cal = parseOverview(readFileSync(chosen, 'utf8'));
    if (!cal) throw new Error(`Could not parse pos_x/pos_y/scale from ${chosen}`);
    notice(`calibration: pos (${cal.posX}, ${cal.posY}) scale ${cal.scale}`);
    return cal;
  });

  await stage('upload-radar', () => {
    // The decoded radar PNG: match the overview's material name when we have it, else
    // the first *_radar*.png the decompiler produced.
    const pngs = walk(outDir, (p) => p.toLowerCase().endsWith('.png'));
    const matSlug = calibration.material?.split('/').pop()?.toLowerCase() ?? 'radar';
    const radar =
      pngs.find((p) => p.toLowerCase().includes(matSlug)) ??
      pngs.find((p) => p.toLowerCase().includes('radar')) ??
      pngs[0];
    if (!radar) throw new Error('No decoded radar PNG found');
    notice(`radar png: ${radar}`);
    return putR2Object(radarKey(mapId), readFileSync(radar), { contentType: 'image/png' });
  });

  await stage('upsert-map', async () => {
    await supabase
      .from('maps')
      .update({
        radar_image_url: radarKey(mapId),
        radar_pos_x: calibration.posX,
        radar_pos_y: calibration.posY,
        radar_scale: calibration.scale,
        radar_source: 'vpk',
      })
      .eq('id', mapId)
      .throwOnError();
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
      .eq('map_id', mapId)
      .throwOnError();
  });

  summary(
    `\n✅ **${mapName}** calibrated — pos (${calibration.posX}, ${calibration.posY}), scale ${calibration.scale}, radar uploaded.`,
  );
  notice(`radar-build complete for "${mapName}"`);
}

main().catch(fail);
