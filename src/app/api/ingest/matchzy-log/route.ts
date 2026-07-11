// Machine-authenticated MatchZy remote-log receiver — the `matchzy_remote_log_url` target (#138).
// MatchZy POSTs every match event here (match_started, round_end, map_result, …); only `map_result`
// is kept, as the independent cross-check trusted auto-commit uses to corroborate the demo-derived
// score. Everything else is acknowledged and dropped. Small JSON body — no Worker needed (unlike the
// demo upload, this payload is tiny).
//
// Auth: shared secret in `x-matchzy-token`, constant-time compared against `INGEST_REMOTE_LOG_SECRET`.

import { NextRequest, NextResponse } from 'next/server';
import { machineSecretGuard } from '@/lib/machine-auth';
import { parseMapResultEvent, putMapResult } from '@/lib/demo/mapResult';

export async function POST(req: NextRequest) {
  const denied = machineSecretGuard(
    req.headers.get('x-matchzy-token'),
    process.env.INGEST_REMOTE_LOG_SECRET,
    'MatchZy remote log not configured',
  );
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const result = parseMapResultEvent(body);
  if (!result) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  await putMapResult(result.matchid, result);
  return NextResponse.json({ ok: true, matchId: result.matchid });
}
