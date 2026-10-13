/**
 * Tests for sortRows (sort-rows.ts). Run: npx vitest run src/lib/sort-rows.test.ts
 */

import assert from 'node:assert/strict';
import { sortRows } from './sort-rows';
import { test } from './test-support/miniTest';

type R = { id: number; name: string; score: number | null };
const rows: R[] = [
  { id: 1, name: 'Carol', score: 5 },
  { id: 2, name: 'alice', score: null },
  { id: 3, name: 'Bob', score: 9 },
  { id: 4, name: 'Dee', score: 5 },
];
const keys = { name: (r: R) => r.name, score: (r: R) => r.score };
const ids = (xs: R[]) => xs.map((r) => r.id);

test('sortRows: an unknown or empty column keeps the incoming order', () => {
  assert.deepEqual(ids(sortRows(rows, { col: '', asc: true }, keys)), [1, 2, 3, 4]);
  assert.deepEqual(ids(sortRows(rows, { col: 'nope', asc: false }, keys)), [1, 2, 3, 4]);
});

test('sortRows: numbers sort either way, nulls always last, ties keep incoming order', () => {
  assert.deepEqual(ids(sortRows(rows, { col: 'score', asc: false }, keys)), [3, 1, 4, 2]);
  assert.deepEqual(ids(sortRows(rows, { col: 'score', asc: true }, keys)), [1, 4, 3, 2]);
});

test('sortRows: strings sort with localeCompare, case-insensitively enough to put alice first', () => {
  assert.deepEqual(ids(sortRows(rows, { col: 'name', asc: true }, keys)), [2, 3, 1, 4]);
  assert.deepEqual(ids(sortRows(rows, { col: 'name', asc: false }, keys)), [4, 1, 3, 2]);
});

test('sortRows does not mutate its input', () => {
  const copy = [...rows];
  sortRows(rows, { col: 'score', asc: true }, keys);
  assert.deepEqual(rows, copy);
});
