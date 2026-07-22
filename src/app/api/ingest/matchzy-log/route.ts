// Machine-authenticated MatchZy remote-log receiver — the `matchzy_remote_log_url` target (#138).
// MatchZy POSTs every match event here (match_started, round_end, map_result, …); only `map_result`'s
// full payload is kept, as the independent cross-check trusted auto-commit uses to corroborate the
// demo-derived score. Every event still updates the last-contact marker (`matchzyContact.ts`) before
// being otherwise dropped, so "did the server ever talk to us for this match" stays answerable after
// the fact. Small JSON body — no Worker needed (unlike the demo upload, this payload is tiny).
//
// Auth: shared secret in `x-matchzy-token`, constant-time compared against `INGEST_REMOTE_LOG_SECRET`.

import { NextRequest, NextResponse } from 'next/server';
import { machineSecretGuard } from '@/lib/machine-auth';
import { parseMapResultEvent, putMapResult } from '@/lib/demo/mapResult';
import { parseMatchzyEventIdentity, putMatchzyContact } from '@/lib/demo/matchzyContact';

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

  // Best-effort: a hiccup recording the contact marker shouldn't turn an otherwise-fine event ack
  // into a 500.
  const identity = parseMatchzyEventIdentity(body);
  if (identity) {
    try {
      await putMatchzyContact(identity.matchid, identity.event);
    } catch (err) {
      console.error(`matchzy-log: could not record contact for match ${identity.matchid}:`, err);
    }
  }

  const result = parseMapResultEvent(body);
  if (!result) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  await putMapResult(result.matchid, result);
  return NextResponse.json({ ok: true, matchId: result.matchid });
}
