// Fire the EHOG rating recompute (Python function at `api/ehog/recompute.py`). Holds the
// `RECOMPUTE_SECRET` server-side, so only server code can trigger a full history walk. Best-effort
// and fire-and-forget: the recompute runs on its own and callers don't await the walk — wrap the
// call in `after()` so it never blocks a response.
//
// Callers: the score write (`src/app/api/matches/[id]/score/route.ts`) and the admin "recompute now"
// control (`src/app/api/ehog/recompute/trigger/route.ts`).

export async function triggerRatingRecompute(): Promise<void> {
  const secret = process.env.RECOMPUTE_SECRET;
  if (!secret) return;
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
  try {
    await fetch(`${base}/api/ehog/recompute`, {
      method: 'POST',
      headers: { 'x-recompute-secret': secret },
    });
  } catch (e) {
    console.error('EHOG recompute trigger failed:', e);
  }
}
