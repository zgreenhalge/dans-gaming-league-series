/**
 * The Tools registry stays in step with the pages it links to: slugs are unique, and every listed
 * tool has a page under src/app/tools/.
 *
 * Run:  npx vitest run src/lib/tools.test.ts
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { TOOLS, getTool, toolCrumbs, toolHref } from './tools';
import { test, report } from './test-support/miniTest';

test('every tool has a unique slug and a page', () => {
  assert.equal(new Set(TOOLS.map((t) => t.slug)).size, TOOLS.length);
  for (const t of TOOLS) {
    const page = path.join(import.meta.dirname, '..', 'app', 'tools', t.slug, 'page.tsx');
    assert.ok(existsSync(page), `${t.slug}: missing ${page}`);
  }
});

test('tool links and breadcrumbs', () => {
  const lab = getTool('schedule-lab');
  assert.equal(toolHref(lab.slug), '/tools/schedule-lab');
  assert.deepEqual(toolCrumbs(lab).map((c) => c.label), ['DGLS', 'Tools', 'Schedule Lab']);
  assert.throws(() => getTool('nope'));
});

report();
