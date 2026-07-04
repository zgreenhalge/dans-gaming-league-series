// Remove stale per-match artifacts from the DatHost match server's local disk: MatchZy's
// round-resume backups (root `matchzy_<id>_*_round*.txt` + `MatchZyDataBackup/*.json`), its
// per-match stat CSV (`MatchZy_Stats/<id>/`), its steamid-name cache (`MatchZyPlayerNames/
// Match_<id>.ini`), and the recorded demo (`MatchZy/<...>_<id>_*.dem`) once it's confirmed safely
// in R2. None of this self-cleans — MatchZy writes it per match and never removes it, so it
// accumulates forever on a disk with a fixed size cap.
//
// The server also hosts non-DGLS games between matches (recreational-mode drift, ad-hoc testing),
// and MatchZy leaves the exact same kind of residue for those — but they have no `matches` row to
// derive an age from, and we don't care about them at all, so they're deleted immediately rather
// than aged. A file whose id *does* match a real `matches` row is only eligible once it's old
// enough that nothing still needs it locally (7-day default), and — for the demo specifically —
// only once R2 has its own confirmed copy. A tracked match this script can't confidently place in
// time (no resolved job, no scheduled_at) is left alone rather than guessed at.
//
//   set -a; . ./.env.local; set +a
//   DRY_RUN=false npx tsx scripts/dathost-cleanup.ts        # actually delete
//   npx tsx scripts/dathost-cleanup.ts                       # DRY_RUN defaults true — list only
//
// Env: DATHOST_EMAIL, DATHOST_PASSWORD, DATHOST_SERVER_ID (or pass a server id as argv[2]),
// NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLOUDFLARE_R2_* (for the demo R2 check).
// RETENTION_DAYS overrides the default 7-day minimum age (matches don't need same-week local
// backups; the demo's own R2 presence check is a stronger, independent safety condition anyway).

import { api } from './dathost-golden-shared';
import { getAdminClient } from '../src/lib/supabase-admin';
import { r2, R2_BUCKET, demoKey } from '../src/lib/r2';
import { HeadObjectCommand } from '@aws-sdk/client-s3';

const DRY_RUN = !/^(0|false)$/i.test(process.env.DRY_RUN ?? 'true');
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? '7');
const DEMO_INGEST_DONE = new Set(['confirmed', 'dismissed']);

function notice(msg: string) {
  console.log(`::notice::${msg}`);
}
function warning(msg: string) {
  console.log(`::warning::${msg}`);
}

interface RemoteFile {
  path: string;
  size: number;
}

async function listAllFiles(serverId: string): Promise<RemoteFile[]> {
  const { status, json } = await api('GET', `/game-servers/${serverId}/files?path=`);
  if (status !== 200 || !Array.isArray(json)) {
    throw new Error(`Could not list server files (status ${status})`);
  }
  return (json as Array<{ path: string; size?: number }>).map((f) => ({
    path: f.path,
    size: f.size ?? 0,
  }));
}

/** Group every match-scoped file by the match id embedded in its path, by known MatchZy pattern. */
function groupByMatchId(files: RemoteFile[]): Map<number, RemoteFile[]> {
  const patterns: RegExp[] = [
    /^matchzy_(\d+)_\d+_round\d+\.txt$/,
    /^MatchZyDataBackup\/matchzy_(\d+)_\d+_round\d+\.json$/,
    /^MatchZy_Stats\/(\d+)\//,
    /^MatchZyPlayerNames\/Match_(\d+)\.ini$/,
    /^MatchZy\/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_(\d+)_.*\.dem$/,
  ];
  const byMatch = new Map<number, RemoteFile[]>();
  for (const file of files) {
    for (const pattern of patterns) {
      const m = pattern.exec(file.path);
      if (!m) continue;
      const matchId = Number(m[1]);
      if (!byMatch.has(matchId)) byMatch.set(matchId, []);
      byMatch.get(matchId)!.push(file);
      break;
    }
  }
  return byMatch;
}

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

/** Whether `matchId` is a real DGLS match, and if so, the date to measure its age from: the
 *  demo-ingest job's resolution time if it reached a terminal state, else the match's scheduled
 *  time (covers matches scored without a demo, e.g. a recording failure), else null — unknown
 *  age, never eligible. `tracked: false` means no `matches` row exists at all — not a DGLS match
 *  (a non-DGLS game or ad-hoc test reusing MatchZy on the shared server), so nothing here is worth
 *  retaining regardless of age. */
async function ageInfoFor(
  supabase: ReturnType<typeof getAdminClient>,
  matchId: number,
): Promise<{ tracked: boolean; days: number | null; jobStatus: string | null }> {
  const [{ data: job }, { data: match }] = await Promise.all([
    supabase
      .from('background_jobs')
      .select('status, updated_at')
      .eq('job_type', 'demo_ingest')
      .eq('match_id', matchId)
      .maybeSingle(),
    supabase.from('matches').select('scheduled_at').eq('id', matchId).maybeSingle(),
  ]);
  const jobStatus = (job as { status?: string } | null)?.status ?? null;
  if (!match) {
    return { tracked: false, days: null, jobStatus };
  }
  if (jobStatus && DEMO_INGEST_DONE.has(jobStatus)) {
    return { tracked: true, days: daysAgo((job as { updated_at?: string }).updated_at ?? null), jobStatus };
  }
  return {
    tracked: true,
    days: daysAgo((match as { scheduled_at?: string }).scheduled_at ?? null),
    jobStatus,
  };
}

async function demoIsSafeInR2(matchId: number): Promise<boolean> {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: demoKey(matchId) }));
    return true;
  } catch {
    return false;
  }
}

async function deleteFile(serverId: string, path: string): Promise<void> {
  if (DRY_RUN) {
    console.log(`  [dry-run] would delete ${path}`);
    return;
  }
  const { status, text } = await api('DELETE', `/game-servers/${serverId}/files/${encodeURIComponent(path)}`);
  if (status >= 200 && status < 300) {
    console.log(`  deleted ${path}`);
  } else {
    warning(`could not delete ${path} (status ${status}): ${text.slice(0, 200)}`);
  }
}

async function main() {
  const serverId = process.argv[2] || process.env.DATHOST_SERVER_ID;
  if (!serverId) throw new Error('Set DATHOST_SERVER_ID or pass a server id as an argument.');
  notice(`dathost-cleanup: server ${serverId}, retention ${RETENTION_DAYS}d, dry_run=${DRY_RUN}`);

  const supabase = getAdminClient();
  const files = await listAllFiles(serverId);
  const byMatch = groupByMatchId(files);
  notice(`found ${byMatch.size} distinct match id(s) with residue on disk`);

  let deletedFiles = 0;
  let freedBytes = 0;
  let skippedMatches = 0;

  for (const [matchId, matchFiles] of [...byMatch.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`::group::match ${matchId} (${matchFiles.length} file(s))`);
    const { tracked, days, jobStatus } = await ageInfoFor(supabase, matchId);
    if (!tracked) {
      console.log(`match ${matchId}: no matches row — not a DGLS match, deleting immediately (no retention)`);
    } else if (days === null) {
      warning(`match ${matchId}: no resolved demo_ingest job and no scheduled_at — skipping (unknown age)`);
      skippedMatches++;
      console.log('::endgroup::');
      continue;
    } else if (days < RETENTION_DAYS) {
      console.log(`match ${matchId}: ${days.toFixed(1)}d old (job=${jobStatus ?? 'none'}), under ${RETENTION_DAYS}d retention — skipping`);
      skippedMatches++;
      console.log('::endgroup::');
      continue;
    }

    for (const file of matchFiles) {
      const isDemo = /^MatchZy\/.*\.dem$/.test(file.path);
      if (isDemo) {
        const safe = await demoIsSafeInR2(matchId);
        if (!safe) {
          warning(`match ${matchId}: demo not confirmed in R2 (${demoKey(matchId)}) — leaving ${file.path} on disk`);
          continue;
        }
      }
      await deleteFile(serverId, file.path);
      deletedFiles++;
      freedBytes += file.size;
    }
    console.log('::endgroup::');
  }

  notice(
    `done: ${deletedFiles} file(s) ${DRY_RUN ? 'would be' : ''} deleted, ` +
      `~${(freedBytes / 1024 / 1024).toFixed(1)} MB ${DRY_RUN ? 'would be' : ''} freed, ` +
      `${skippedMatches} match(es) skipped (under retention or unknown age)`,
  );
}

main().catch((err) => {
  console.log(`::error::dathost-cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
