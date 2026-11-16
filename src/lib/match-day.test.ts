/**
 * Tests for the match-day writers in `match-day.ts`: every writer throws `MatchNotFoundError` for an
 * id no match has, and `setVetoFields()` writes only while its `expected` fields still hold the values
 * the caller read.
 *
 * Run:  npx vitest run src/lib/match-day.test.ts
 */

import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { test, report } from '@/lib/test-support/miniTest';
import {
  MatchNotFoundError,
  VetoStepChangedError,
  getVetoFields,
  setMatchFeatured,
  setMatchRecording,
  setMatchScheduledAt,
  setVetoFields,
} from './match-day';

const MATCH_ID = 100;
const MISSING_ID = 999;

function makeDb(): FakeDb {
  return {
    matches: [
      {
        id: MATCH_ID, week_id: 1, scheduled_at: null, is_feature_match: false, recording_url: null,
        shirts_ban: null, shirts_ban2: null, skins_ban1: null, skins_ban2: null, shirts_pick: null, skins_starting_side: null,
      },
    ],
  };
}

function setup() {
  const db = makeDb();
  return { db, client: createFakeSupabaseClient(db) as unknown as SupabaseClient };
}

async function main() {
  await test('setMatchScheduledAt — a missing match throws MatchNotFoundError', async () => {
    await assert.rejects(setMatchScheduledAt(setup().client, MISSING_ID, '2026-01-01T00:00:00.000Z'), MatchNotFoundError);
  });

  await test('setMatchFeatured — a missing match throws MatchNotFoundError', async () => {
    await assert.rejects(setMatchFeatured(setup().client, MISSING_ID, true), MatchNotFoundError);
  });

  await test('setMatchRecording — a missing match throws MatchNotFoundError', async () => {
    await assert.rejects(setMatchRecording(setup().client, MISSING_ID, 'https://example.com/r'), MatchNotFoundError);
  });

  await test('setVetoFields — a missing match throws MatchNotFoundError, guarded or not', async () => {
    const { client } = setup();
    await assert.rejects(setVetoFields(client, MISSING_ID, { shirts_ban: 'Nuke' }), MatchNotFoundError);
    await assert.rejects(setVetoFields(client, MISSING_ID, { shirts_ban: 'Nuke' }, { shirts_ban: null }), MatchNotFoundError);
    await assert.rejects(setVetoFields(client, MISSING_ID, { shirts_ban: 'Nuke' }, { shirts_ban: 'Vertigo' }), MatchNotFoundError);
  });

  await test('getVetoFields — a missing match throws MatchNotFoundError', async () => {
    await assert.rejects(getVetoFields(setup().client, MISSING_ID), MatchNotFoundError);
  });

  await test('the writers update an existing match', async () => {
    const { db, client } = setup();
    await setMatchScheduledAt(client, MATCH_ID, '2026-01-01T00:00:00.000Z');
    await setMatchFeatured(client, MATCH_ID, true);
    await setMatchRecording(client, MATCH_ID, 'https://example.com/r');
    assert.deepEqual(
      [db.matches[0].scheduled_at, db.matches[0].is_feature_match, db.matches[0].recording_url],
      ['2026-01-01T00:00:00.000Z', true, 'https://example.com/r'],
    );
  });

  await test('setVetoFields — returns the pick/ban fields as the write left them', async () => {
    const { db, client } = setup();
    db.matches[0].skins_ban1 = 'Vertigo';
    const row = await setVetoFields(client, MATCH_ID, { shirts_ban: 'Nuke' }, { shirts_ban: null });
    assert.equal(row.shirts_ban, 'Nuke');
    assert.equal(row.skins_ban1, 'Vertigo', 'a field the write left alone is in the returned row');
  });

  await test('setVetoFields — a first fill of a field another request filled throws VetoStepChangedError', async () => {
    const { db, client } = setup();
    db.matches[0].shirts_ban = 'Vertigo';
    await assert.rejects(setVetoFields(client, MATCH_ID, { shirts_ban: 'Nuke' }, { shirts_ban: null }), VetoStepChangedError);
    assert.equal(db.matches[0].shirts_ban, 'Vertigo');
  });

  await test('setVetoFields — an overwrite of a value that has since changed throws VetoStepChangedError', async () => {
    const { db, client } = setup();
    db.matches[0].shirts_ban = 'Inferno';
    await assert.rejects(setVetoFields(client, MATCH_ID, { shirts_ban: 'Nuke' }, { shirts_ban: 'Vertigo' }), VetoStepChangedError);
    assert.equal(db.matches[0].shirts_ban, 'Inferno');
    await setVetoFields(client, MATCH_ID, { shirts_ban: 'Nuke' }, { shirts_ban: 'Inferno' });
    assert.equal(db.matches[0].shirts_ban, 'Nuke');
  });

  await test('setVetoFields — without `expected` it overwrites unconditionally', async () => {
    const { db, client } = setup();
    db.matches[0].shirts_ban = 'Inferno';
    await setVetoFields(client, MATCH_ID, { shirts_ban: null });
    assert.equal(db.matches[0].shirts_ban, null);
  });

  report();
}

await main();
