import { NextRequest, NextResponse } from 'next/server';
import { getR2Object, replayKey } from '@/lib/r2';

// Serves the full `replay.json` payload (frames + grenades + events) for the client
// `<ReplayPlayer>`. The Events tab uses a stripped server-side projection
// (`getReplayEventsView`); the 2D player needs the whole payload, which is multi-MB,
// so it's fetched lazily from here only when the user opens the Replay sub-tab —
// never bundled into the server-rendered match page. See `docs/replay.md`.
//
// Read-only and unauthenticated, consistent with the match page itself (which already
// renders the events list publicly). Heavy compute stays in the GitHub Action; this
// just streams the deterministic R2 object.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const matchId = Number(id);
  if (!Number.isFinite(matchId)) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const buf = await getR2Object(replayKey(matchId));
  if (!buf) {
    return NextResponse.json({ error: 'No replay payload for this match' }, { status: 404 });
  }

  // Stored gzipped (Action A gzips before upload). Detect the gzip magic bytes and
  // pass the compressed bytes straight through with Content-Encoding so the browser
  // inflates it — no server-side gunzip/re-gzip round trip.
  const gz = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  const body = new Uint8Array(buf);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    // Deterministic key, overwritten on re-dispatch — keep the window short so a
    // freshly regenerated replay shows up without a hard refresh.
    'Cache-Control': 'private, max-age=30',
  };
  if (gz) headers['Content-Encoding'] = 'gzip';

  return new NextResponse(body, { status: 200, headers });
}
