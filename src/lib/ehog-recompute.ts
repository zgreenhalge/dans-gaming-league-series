// Fire the EHOG rating recompute (Python function at `api/ehog/recompute.py`). Holds the
// `RECOMPUTE_SECRET` server-side, so only server code can trigger a full history walk. Best-effort
// and fire-and-forget: the recompute runs on its own and callers don't await the walk — wrap the
// call in `after()` so it never blocks a response.
//
// Callers: the score write (`src/app/api/matches/[id]/score/route.ts`) and the admin "recompute now"
// control (`src/app/api/ehog/recompute/trigger/route.ts`).

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordOpsError, clearOpsError } from './ops-errors';

/** There's no per-match or per-season entity a recompute failure belongs to — it's a single
 * site-wide history walk — so it's recorded against the `system` entity type's singleton id. */
export async function triggerRatingRecompute(supabaseAdmin: SupabaseClient): Promise<void> {
  const secret = process.env.RECOMPUTE_SECRET;
  if (!secret) return;
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
  try {
    const res = await fetch(`${base}/api/ehog/recompute`, {
      method: 'POST',
      headers: { 'x-recompute-secret': secret },
    });
    if (!res.ok) throw new Error(`recompute endpoint responded ${res.status}`);
    await clearOpsError(supabaseAdmin, 'system', 0, 'ehog_recompute');
  } catch (e) {
    console.error('EHOG recompute trigger failed:', e);
    await recordOpsError(supabaseAdmin, 'system', 0, 'ehog_recompute', `EHOG recompute failed: ${(e as Error).message}`);
  }
}
