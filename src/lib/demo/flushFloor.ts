// How much of fetchFromDathost.ts's post-map_result flush floor is still outstanding for a match's
// demo — anchored to when map_result actually fired, not to whichever job happens to be asking.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getJobCreatedAt, matchJobKey } from '../background-jobs';
import { remainingFlushFloorMs } from './fetchFromDathost';
import { DEMO_INGEST_JOB_TYPE } from './ingestResult';

/**
 * How much of `FLUSH_FLOOR_MS` is still outstanding for `matchId`'s demo — for `ensureDemoInR2()`'s
 * `getFlushFloorMs` option. Always anchors to the `demo_ingest` job row's `created_at`, never to the
 * caller's own job type: `demo_ingest` is claimed unconditionally the instant `map_result` fires
 * (`dispatchDemoIngest` in `matchzy-log`'s handler), while e.g. `replay_extract`'s own row only exists
 * if `REPLAY_AUTO_DISPATCH` dispatched it or a manual "Regenerate" claimed one — neither reliably
 * anchors "when did `map_result` actually happen" the way `demo_ingest`'s row does. `demo-ingest.ts`
 * and `replay-extract.ts` both call this rather than composing `getJobCreatedAt()` +
 * `remainingFlushFloorMs()` themselves, so that anchor choice is enforced in this one place instead of
 * relied on — via a comment alone — at every call site.
 */
export async function demoIngestFlushFloorMs(supabase: SupabaseClient, matchId: number): Promise<number> {
  const mapResultAt = await getJobCreatedAt(supabase, DEMO_INGEST_JOB_TYPE, matchJobKey(matchId));
  return remainingFlushFloorMs(mapResultAt);
}
