/**
 * Unit tests for the pure domain logic in jobs.ts: the "needs attention" predicate, the elapsed-
 * duration label, and subject grouping/ordering for the background-jobs dashboard.
 *
 * Run:
 *   npx tsx src/lib/jobs.test.ts
 */

import assert from 'node:assert/strict';
import {
  jobNeedsAttention,
  jobDurationLabel,
  jobIsStale,
  isStale,
  STALE_IN_FLIGHT_MS,
  groupBackgroundJobs,
  type BackgroundJobRow,
} from './jobs';
import { test, report } from './test-support/miniTest';

function matchJob(overrides: Partial<BackgroundJobRow> = {}): BackgroundJobRow {
  return {
    jobType: 'demo_ingest',
    status: 'succeeded',
    stage: null,
    errorMessage: null,
    ghRunUrl: null,
    createdAt: null,
    updatedAt: null,
    startedAt: null,
    finishedAt: null,
    subject: {
      kind: 'match',
      matchId: 1,
      label: 'Match 1',
      href: '/matches/1',
      seasonNumber: 1,
      weekNumber: 1,
      matchNumber: 1,
      pickedMap: null,
      finalScore: null,
      isGauntlet: false,
    },
    warnings: [],
    quarantineFlags: [],
    hasPayload: false,
    ...overrides,
  };
}

function mapJob(overrides: Partial<BackgroundJobRow> = {}): BackgroundJobRow {
  return {
    jobType: 'radar_build',
    status: 'succeeded',
    stage: null,
    errorMessage: null,
    ghRunUrl: null,
    createdAt: null,
    updatedAt: null,
    startedAt: null,
    finishedAt: null,
    subject: { kind: 'map', mapId: 1, slug: 'foroglio', label: 'Foroglio', href: '/maps/foroglio' },
    warnings: [],
    quarantineFlags: [],
    hasPayload: false,
    ...overrides,
  };
}

// --- jobNeedsAttention ---

test('jobNeedsAttention: demo_ingest flags parsed and quarantined', () => {
  assert.equal(jobNeedsAttention(matchJob({ status: 'parsed' })), true);
  assert.equal(jobNeedsAttention(matchJob({ status: 'quarantined' })), true);
});

test('jobNeedsAttention: demo_ingest does not flag in-progress or succeeded', () => {
  assert.equal(jobNeedsAttention(matchJob({ status: 'received' })), false);
  assert.equal(jobNeedsAttention(matchJob({ status: 'queued' })), false);
  assert.equal(jobNeedsAttention(matchJob({ status: 'running' })), false);
  assert.equal(jobNeedsAttention(matchJob({ status: 'succeeded' })), false);
});

test('jobNeedsAttention: failed flags across every job type', () => {
  assert.equal(jobNeedsAttention(matchJob({ jobType: 'demo_ingest', status: 'failed' })), true);
  assert.equal(jobNeedsAttention(matchJob({ jobType: 'replay_extract', status: 'failed' })), true);
  assert.equal(jobNeedsAttention(matchJob({ jobType: 'ehog_recompute', status: 'failed' })), true);
  assert.equal(jobNeedsAttention(mapJob({ jobType: 'radar_build', status: 'failed' })), true);
});

test('jobNeedsAttention: non-demo pipelines do not flag on parsed/quarantined-shaped statuses', () => {
  assert.equal(jobNeedsAttention(matchJob({ jobType: 'replay_extract', status: 'parsed' })), false);
  assert.equal(jobNeedsAttention(matchJob({ jobType: 'replay_extract', status: 'succeeded' })), false);
});

// --- jobIsStale / isStale ---

test('isStale: false when under the threshold, true once past it', () => {
  const updatedAt = '2026-01-01T00:00:00.000Z';
  const justUnder = new Date(updatedAt).getTime() + STALE_IN_FLIGHT_MS - 1;
  const justOver = new Date(updatedAt).getTime() + STALE_IN_FLIGHT_MS + 1;
  assert.equal(isStale(updatedAt, justUnder), false);
  assert.equal(isStale(updatedAt, justOver), true);
});

test('isStale: false with no updatedAt to judge by', () => {
  assert.equal(isStale(null, Date.now()), false);
});

test('jobIsStale: false for a non-in-progress status regardless of updatedAt age', () => {
  const job = matchJob({ status: 'succeeded', updatedAt: '2020-01-01T00:00:00.000Z' });
  assert.equal(jobIsStale(job, Date.now()), false);
});

test('jobIsStale: true for an in-progress job whose updatedAt heartbeat has gone quiet', () => {
  const job = matchJob({ status: 'running', updatedAt: '2026-01-01T00:00:00.000Z' });
  const now = new Date('2026-01-01T00:00:00.000Z').getTime() + STALE_IN_FLIGHT_MS + 1;
  assert.equal(jobIsStale(job, now), true);
});

// See isStale()'s doc comment (jobs.ts) for why this is judged off updatedAt rather than
// startedAt/createdAt — a redispatch only ever refreshes the former.
test('jobIsStale: a fresh redispatch is not stale even with days-old startedAt/createdAt', () => {
  const job = matchJob({
    status: 'queued',
    updatedAt: '2026-01-04T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  const now = new Date('2026-01-04T00:00:01.000Z').getTime();
  assert.equal(jobIsStale(job, now), false);
});

// --- jobDurationLabel ---

test('jobDurationLabel: in-progress uses startedAt and nowMs', () => {
  const job = matchJob({ status: 'running', startedAt: '2026-01-01T00:00:00.000Z' });
  const now = new Date('2026-01-01T00:02:00.000Z').getTime();
  assert.equal(jobDurationLabel(job, now), 'running 2m');
});

test('jobDurationLabel: in-progress falls back to createdAt when startedAt is missing', () => {
  const job = matchJob({ status: 'queued', startedAt: null, createdAt: '2026-01-01T00:00:00.000Z' });
  const now = new Date('2026-01-01T00:05:00.000Z').getTime();
  assert.equal(jobDurationLabel(job, now), 'running 5m');
});

test('jobDurationLabel: in-progress with no nowMs yet is null', () => {
  const job = matchJob({ status: 'running', startedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(jobDurationLabel(job, null), null);
});

test('jobDurationLabel: finished job reports "took"', () => {
  const job = matchJob({
    status: 'succeeded',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:04:00.000Z',
  });
  assert.equal(jobDurationLabel(job, null), 'took 4m');
});

test('jobDurationLabel: finished job with no finishedAt yet is null', () => {
  const job = matchJob({ status: 'succeeded', startedAt: '2026-01-01T00:00:00.000Z', finishedAt: null });
  assert.equal(jobDurationLabel(job, null), null);
});

test('jobDurationLabel: no startedAt and no createdAt is null', () => {
  const job = matchJob({ status: 'succeeded', startedAt: null, createdAt: null });
  assert.equal(jobDurationLabel(job, null), null);
});

// --- groupBackgroundJobs ---

test('groupBackgroundJobs: groups jobs by match/map key', () => {
  const rows = [
    matchJob({ jobType: 'demo_ingest', subject: { ...matchJob().subject, matchId: 1 } as never }),
    matchJob({ jobType: 'replay_extract', subject: { ...matchJob().subject, matchId: 1 } as never }),
    mapJob({ jobType: 'radar_build', subject: { ...mapJob().subject, mapId: 2 } as never }),
  ];
  const groups = groupBackgroundJobs(rows);
  assert.equal(groups.length, 2);
  const matchGroup = groups.find((g) => g.key === 'match:1');
  assert.ok(matchGroup);
  assert.equal(matchGroup!.lanes.length, 2);
  const mapGroup = groups.find((g) => g.key === 'map:2');
  assert.ok(mapGroup);
  assert.equal(mapGroup!.lanes.length, 1);
});

test('groupBackgroundJobs: lanes order demo, replay, ehog within a match card', () => {
  const rows = [
    matchJob({ jobType: 'ehog_recompute' }),
    matchJob({ jobType: 'demo_ingest' }),
    matchJob({ jobType: 'replay_extract' }),
  ];
  const [group] = groupBackgroundJobs(rows);
  assert.deepEqual(
    group.lanes.map((l) => l.job.jobType),
    ['demo_ingest', 'replay_extract', 'ehog_recompute'],
  );
});

test('groupBackgroundJobs: match groups sort before map groups', () => {
  const rows = [mapJob(), matchJob()];
  const groups = groupBackgroundJobs(rows);
  assert.deepEqual(
    groups.map((g) => g.subject.kind),
    ['match', 'map'],
  );
});

test('groupBackgroundJobs: match groups use canonical season/week/match descending order', () => {
  const early = matchJob({
    subject: {
      kind: 'match',
      matchId: 1,
      label: 'S1 Wk1 M1',
      href: '/matches/1',
      seasonNumber: 1,
      weekNumber: 1,
      matchNumber: 1,
      pickedMap: null,
      finalScore: null,
      isGauntlet: false,
    },
  });
  const late = matchJob({
    subject: {
      kind: 'match',
      matchId: 2,
      label: 'S2 Wk1 M1',
      href: '/matches/2',
      seasonNumber: 2,
      weekNumber: 1,
      matchNumber: 1,
      pickedMap: null,
      finalScore: null,
      isGauntlet: false,
    },
  });
  const groups = groupBackgroundJobs([early, late]);
  assert.deepEqual(
    groups.map((g) => g.key),
    ['match:2', 'match:1'],
  );
});

test('groupBackgroundJobs: map groups sort alphabetically by label', () => {
  const rows = [
    mapJob({ subject: { kind: 'map', mapId: 2, slug: 'valeria', label: 'Valeria', href: '/maps/valeria' } }),
    mapJob({ subject: { kind: 'map', mapId: 1, slug: 'foroglio', label: 'Foroglio', href: '/maps/foroglio' } }),
  ];
  const groups = groupBackgroundJobs(rows);
  assert.deepEqual(
    groups.map((g) => g.subject.label),
    ['Foroglio', 'Valeria'],
  );
});

report();
