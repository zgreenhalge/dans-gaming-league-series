/**
 * Regression harness for fakeSupabase.ts's `.update()`/`.rpc()`/`.upsert()` support (#386) — exercises
 * `FakeQueryBuilder` and `FakeSupabaseClient` directly rather than through `queries.ts`, since these
 * methods don't have a real call site test yet (that's #379/#380/#382).
 *
 * Run:  npx tsx src/lib/test-support/fakeSupabase.test.ts
 */

import assert from 'node:assert/strict';
import { createFakeSupabaseClient, type FakeDb } from './fakeSupabase';
import { test, report } from './miniTest';

async function main() {
  await test('.update() — applies values only to rows matching the chained filters', async () => {
    const db: FakeDb = { players: [{ id: 1, name: 'a', status: 'ACTIVE' }, { id: 2, name: 'b', status: 'ACTIVE' }] };
    const client = createFakeSupabaseClient(db);
    const { error } = await client.from('players').update({ status: 'BENCHED' }).eq('id', 1);
    assert.equal(error, null);
    assert.equal(db.players[0].status, 'BENCHED');
    assert.equal(db.players[1].status, 'ACTIVE');
  });

  await test('.update() — data is null when .select() is not chained, matching return=minimal', async () => {
    const db: FakeDb = { players: [{ id: 1, status: 'ACTIVE' }] };
    const client = createFakeSupabaseClient(db);
    const { data } = await client.from('players').update({ status: 'BENCHED' }).eq('id', 1);
    assert.equal(data, null);
  });

  await test('.update() — .select().maybeSingle() returns the updated row, projected', async () => {
    const db: FakeDb = { players: [{ id: 1, name: 'a', status: 'ACTIVE', seed_ehog: 50 }] };
    const client = createFakeSupabaseClient(db);
    const { data } = await client.from('players').update({ seed_ehog: 60 }).eq('id', 1).select('id, seed_ehog').maybeSingle();
    assert.deepEqual(data, { id: 1, seed_ehog: 60 });
  });

  await test('.update() — .maybeSingle() returns null when no row matches', async () => {
    const db: FakeDb = { players: [{ id: 1, status: 'ACTIVE' }] };
    const client = createFakeSupabaseClient(db);
    const { data } = await client.from('players').update({ status: 'BENCHED' }).eq('id', 999).select('*').maybeSingle();
    assert.equal(data, null);
  });

  await test('.update() — an .or() clause chained after .update() gates which rows are touched', async () => {
    const db: FakeDb = {
      seasons: [
        { id: 1, status: 'UPCOMING' },
        { id: 2, status: 'ACTIVE' },
        { id: 3, status: 'COMPLETED' },
      ],
    };
    const client = createFakeSupabaseClient(db);
    await client.from('seasons').update({ status: 'ARCHIVED' }).or('status.eq.ACTIVE,status.eq.COMPLETED');
    assert.deepEqual(
      db.seasons.map((s) => s.status),
      ['UPCOMING', 'ARCHIVED', 'ARCHIVED'],
    );
  });

  await test('.rpc() — passes args through to the registered fake and returns its result', async () => {
    const db: FakeDb = {};
    let receivedArgs: Record<string, unknown> | null = null;
    const client = createFakeSupabaseClient(db, {
      reconcile_gauntlet_draft: (args) => {
        receivedArgs = args;
        return { data: { key_map: { 'new-1': 42 }, skipped_pod_ids: [] }, error: null };
      },
    });
    const { data, error } = await client.rpc('reconcile_gauntlet_draft', { p_delete_pod_ids: [1, 2] });
    assert.deepEqual(receivedArgs, { p_delete_pod_ids: [1, 2] });
    assert.equal(error, null);
    assert.deepEqual(data, { key_map: { 'new-1': 42 }, skipped_pod_ids: [] });
  });

  await test('.rpc() — an unregistered name throws rather than silently no-opping', async () => {
    const client = createFakeSupabaseClient({});
    await assert.rejects(async () => {
      await client.rpc('not_registered', {});
    }, /no fake registered for rpc "not_registered"/);
  });

  await test('.upsert() — inserts a row with no existing conflict-column match', async () => {
    const db: FakeDb = { background_jobs: [] };
    const client = createFakeSupabaseClient(db);
    const { data } = await client
      .from('background_jobs')
      .upsert({ job_type: 'demo-ingest', match_id: 5, status: 'received' }, { onConflict: 'job_type,match_id' })
      .select('match_id');
    assert.deepEqual(data, [{ match_id: 5 }]);
    assert.equal(db.background_jobs.length, 1);
  });

  await test('.upsert() — updates the existing row in place on a composite conflict-column match, data null without .select()', async () => {
    const db: FakeDb = { background_jobs: [{ job_type: 'demo-ingest', match_id: 5, status: 'received' }] };
    const client = createFakeSupabaseClient(db);
    const { data } = await client
      .from('background_jobs')
      .upsert({ job_type: 'demo-ingest', match_id: 5, status: 'queued' }, { onConflict: 'job_type,match_id' });
    assert.equal(data, null);
    assert.equal(db.background_jobs.length, 1);
    assert.equal(db.background_jobs[0].status, 'queued');
  });

  await test('.upsert() — defaults the conflict target to "id" when onConflict is omitted', async () => {
    const db: FakeDb = { maps: [{ id: 1, slug: 'dust2', name: 'Dust II' }] };
    const client = createFakeSupabaseClient(db);
    await client.from('maps').upsert({ id: 1, slug: 'dust2', name: 'Dust II (Updated)' });
    assert.equal(db.maps.length, 1);
    assert.equal(db.maps[0].name, 'Dust II (Updated)');
  });

  await test('.upsert() — ignoreDuplicates leaves a conflicting row untouched and omits it from the return', async () => {
    const db: FakeDb = { background_jobs: [{ job_type: 'demo-ingest', match_id: 5, status: 'received' }] };
    const client = createFakeSupabaseClient(db);
    const { data } = await client
      .from('background_jobs')
      .upsert(
        { job_type: 'demo-ingest', match_id: 5, status: 'received' },
        { onConflict: 'job_type,match_id', ignoreDuplicates: true },
      )
      .select('match_id');
    assert.deepEqual(data, []);
    assert.equal(db.background_jobs[0].status, 'received');
  });

  await test('.upsert() — ignoreDuplicates still inserts a genuinely new row and returns it', async () => {
    const db: FakeDb = { background_jobs: [{ job_type: 'demo-ingest', match_id: 5, status: 'received' }] };
    const client = createFakeSupabaseClient(db);
    const { data } = await client
      .from('background_jobs')
      .upsert(
        { job_type: 'demo-ingest', match_id: 6, status: 'received' },
        { onConflict: 'job_type,match_id', ignoreDuplicates: true },
      )
      .select('match_id');
    assert.deepEqual(data, [{ match_id: 6 }]);
    assert.equal(db.background_jobs.length, 2);
  });

  report();
}

main();
