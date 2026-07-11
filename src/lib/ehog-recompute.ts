// Fire the EHOG rating recompute (Python function at `api/ehog/recompute.py`). Holds the
// `RECOMPUTE_SECRET` server-side, so only server code can trigger a full history walk. Best-effort;
// in a request handler, callers wrap the call in `after()` so it never blocks the response — the
// demo-ingest Action (no request scope) awaits it directly instead.
//
// Callers: `writeMatchScore` (`src/lib/matchScore.ts`, shared by the interactive score route and the
// demo-ingest Action's auto-commit) and the admin "recompute now" control
// (`src/app/api/ehog/recompute/trigger/route.ts`).

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordOpsError, clearOpsError } from './ops-errors';

/** There's no per-match or per-season entity a recompute failure belongs to — it's a single
 * site-wide history walk — so it's recorded against the `system` entity type's singleton id. */
export async function triggerRatingRecompute(supabaseAdmin: SupabaseClient): Promise<void> {
  const secret = process.env.RECOMPUTE_SECRET;
  if (!secret) return;
  // APP_BASE_URL covers the demo-ingest Action, which runs outside Vercel and has no VERCEL_URL.
  const base =
    process.env.APP_BASE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
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
