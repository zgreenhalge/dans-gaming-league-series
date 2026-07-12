/**
 * Minimal golden-master snapshot helper for the queries.ts regression harness — proves a
 * mechanical refactor changed nothing, by comparing a function's current output against a
 * checked-in copy of what it produced before the refactor. No new dependency: `node:fs` +
 * `node:assert` only, matching the rest of this codebase's zero-dependency test convention.
 *
 * Regenerate with `UPDATE_SNAPSHOTS=1 npx tsx <test file>` — but only when a change to the
 * snapshotted output is expected and has been reviewed; regenerating blindly defeats the point.
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return { __type: 'Map', entries: Array.from(value.entries()) };
  if (value instanceof Set) return { __type: 'Set', values: Array.from(value.values()) };
  return value;
}

function serialize(value: unknown): string {
  return JSON.stringify(value, replacer, 2);
}

const SNAPSHOT_DIR = path.join(__dirname, '__snapshots__');

export function matchesSnapshot(name: string, value: unknown): void {
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const file = path.join(SNAPSHOT_DIR, `${name}.snap.json`);
  const actual = serialize(value);

  if (process.env.UPDATE_SNAPSHOTS === '1' || !fs.existsSync(file)) {
    fs.writeFileSync(file, actual);
    return;
  }

  const expected = fs.readFileSync(file, 'utf8');
  assert.equal(
    actual,
    expected,
    `Snapshot mismatch for "${name}" — if this change is expected, review the diff, then rerun with UPDATE_SNAPSHOTS=1 to update it.`,
  );
}
