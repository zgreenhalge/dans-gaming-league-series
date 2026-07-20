// Re-dispatch the radar-build Action for a map (#145). Admin-gated — radar is keyed by map, not by a
// match/player, so there's no in-match fallback like the demo/replay dispatchers. Mirrors those
// routes: guard against an in-flight job, record `queued`, then fire the GitHub Action (SteamCMD +
// Source2Viewer run there, not in this request — see docs/replay.md).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getAdminClient } from '@/lib/supabase-admin';
import { isPlayerAdmin } from '@/lib/queries';
import { dispatchWorkflow } from '@/lib/gh-dispatch';
import { recordJobStatus, mapJobKey } from '@/lib/background-jobs';

const JOB_TYPE = 'radar_build';
const IN_PROGRESS: ReadonlySet<string> = new Set(['queued', 'running']);

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getServerSession(authOptions);
  const playerId = session?.user?.playerId;
  if (!playerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isPlayerAdmin(playerId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { slug } = await params;
  const supabaseAdmin = getAdminClient();

  // Resolve the slug to a map id — radar-build.yml is keyed by numeric map_id.
  const { data: mapRow } = await supabaseAdmin
    .from('maps')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  const mapId = (mapRow as { id?: number } | null)?.id;
  if (!mapId) return NextResponse.json({ error: 'Unknown map' }, { status: 404 });

  // Don't fire a second Action while one is already working this map.
  const { data: existing } = await supabaseAdmin
    .from('background_jobs')
    .select('status')
    .eq('job_type', JOB_TYPE)
    .eq('map_id', mapId)
    .maybeSingle();
  const existingStatus = (existing as { status?: string } | null)?.status;
  if (existingStatus && IN_PROGRESS.has(existingStatus)) {
    return NextResponse.json({ ok: true, status: existingStatus, alreadyRunning: true });
  }

  const dispatch = await dispatchWorkflow('radar-build.yml', { map_id: String(mapId) });
  if (!dispatch.ok) {
    return NextResponse.json(
      { error: `Could not start a radar build: ${dispatch.error}` },
      { status: 503 },
    );
  }

  const { error: recordErr } = await recordJobStatus(supabaseAdmin, JOB_TYPE, mapJobKey(mapId), {
    status: 'queued',
    stage: 'queued',
    error_message: null,
  });
  if (recordErr) {
    console.error(`radar-build dispatch for map ${mapId} succeeded but recording it failed: ${recordErr}`);
  }

  return NextResponse.json({ ok: true, status: 'queued' });
}
