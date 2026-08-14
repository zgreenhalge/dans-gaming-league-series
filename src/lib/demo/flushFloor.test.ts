/**
 * Unit tests for `demoIngestFlushFloorMs()` — confirms it anchors to the `demo_ingest` job row's
 * `created_at` (via `getJobCreatedAt`) rather than any other job type's row, then defers the actual
 * remaining-time math to `remainingFlushFloorMs()` (already locked by `fetchFromDathost.test.ts`).
 *
 * Run:  npx vitest run src/lib/demo/flushFloor.test.ts
 */

import assert from 'node:assert/strict';
import { demoIngestFlushFloorMs } from './flushFloor';
import { FLUSH_FLOOR_MS } from './fetchFromDathost';
import { createFakeSupabaseClient, type FakeDb } from '../test-support/fakeSupabase';
import { test, report } from '../test-support/miniTest';

const MATCH_ID = 100;

async function main() {
  await test('demoIngestFlushFloorMs: no demo_ingest job row yet gets the full floor', async () => {
    const db: FakeDb = { background_jobs: [] };
    const supabase = createFakeSupabaseClient(db);
    const remaining = await demoIngestFlushFloorMs(supabase, MATCH_ID);
    assert.equal(remaining, FLUSH_FLOOR_MS);
  });

  await test('demoIngestFlushFloorMs: anchors to the demo_ingest row for this match, not another job type or match', async () => {
    const db: FakeDb = {
      background_jobs: [
        { job_type: 'replay_extract', match_id: MATCH_ID, created_at: new Date().toISOString() }, // wrong job type
        { job_type: 'demo_ingest', match_id: 999, created_at: new Date().toISOString() }, // wrong match
        { job_type: 'demo_ingest', match_id: MATCH_ID, created_at: new Date(Date.now() - FLUSH_FLOOR_MS).toISOString() },
      ],
    };
    const supabase = createFakeSupabaseClient(db);
    const remaining = await demoIngestFlushFloorMs(supabase, MATCH_ID);
    assert.equal(remaining, 0); // exactly one floor-length ago
  });

  await test('demoIngestFlushFloorMs: a recent demo_ingest row still needs roughly the full floor', async () => {
    const db: FakeDb = {
      background_jobs: [{ job_type: 'demo_ingest', match_id: MATCH_ID, created_at: new Date().toISOString() }],
    };
    const supabase = createFakeSupabaseClient(db);
    const remaining = await demoIngestFlushFloorMs(supabase, MATCH_ID);
    assert.ok(remaining > FLUSH_FLOOR_MS - 1000 && remaining <= FLUSH_FLOOR_MS, `expected ~${FLUSH_FLOOR_MS}, got ${remaining}`);
  });

  report();
}

await main();
