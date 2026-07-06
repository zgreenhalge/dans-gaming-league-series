/**
 * Unit tests for the elimination-warning round-trip. The warning string is the carrier for
 * demo-learned steam ids (the score-confirm path parses it back), so the builder and parser must
 * stay in lockstep — this locks that.
 *
 * Run:  npx tsx src/lib/parsers/rosterResolver.test.ts
 */

import assert from 'node:assert/strict';
import { eliminationWarning, parseEliminationWarning, resolveRoster } from './rosterResolver';
import type { RosterEntry } from '../demoParser';

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${(err as Error).message.replace(/\n/g, '\n    ')}`);
  }
}

test('build → parse round-trips the parts', () => {
  const w = eliminationWarning('RedLetter', '76561198028252465', 'Tim');
  const r = parseEliminationWarning(w);
  assert.deepEqual(r, { demoName: 'RedLetter', steamId: '76561198028252465', rosterName: 'Tim' });
});

test('names with spaces round-trip', () => {
  const w = eliminationWarning('Red Letter Day', '76561198000000001', 'Big Tim');
  const r = parseEliminationWarning(w);
  assert.equal(r?.demoName, 'Red Letter Day');
  assert.equal(r?.rosterName, 'Big Tim');
  assert.equal(r?.steamId, '76561198000000001');
});

test('a non-elimination warning parses to null', () => {
  assert.equal(parseEliminationWarning('Starting side unknown — enter the score manually.'), null);
  assert.equal(parseEliminationWarning(''), null);
});

// --- resolveRoster: 3-pass demo-player -> roster-slot matching ---

function slot(overrides: Partial<RosterEntry>): RosterEntry {
  return {
    player_id: 1,
    faction: 'SHIRTS',
    steam_id: null,
    name: 'Player',
    steam_nickname: null,
    ...overrides,
  };
}

test('resolveRoster: pass 1 matches by exact steam id, ignoring name entirely', () => {
  const roster: RosterEntry[] = [slot({ player_id: 1, steam_id: '111', name: 'Tim', faction: 'SHIRTS' })];
  const demoPlayers = [{ steamId: '111', name: 'CompletelyDifferentName' }];
  const warnings: string[] = [];
  const resolved = resolveRoster(demoPlayers, roster, warnings);
  assert.deepEqual(resolved.get('111'), { player_id: 1, faction: 'SHIRTS' });
  assert.equal(warnings.length, 0);
});

test('resolveRoster: pass 2 matches by name (case/whitespace-insensitive) when steam id is unknown', () => {
  const roster: RosterEntry[] = [slot({ player_id: 2, steam_id: null, name: 'Big Tim', faction: 'SKINS' })];
  const demoPlayers = [{ steamId: '222', name: '  BIG   TIM  ' }];
  const warnings: string[] = [];
  const resolved = resolveRoster(demoPlayers, roster, warnings);
  assert.deepEqual(resolved.get('222'), { player_id: 2, faction: 'SKINS' });
});

test('resolveRoster: pass 2 falls back to steam_nickname when the real name does not match', () => {
  const roster: RosterEntry[] = [slot({ player_id: 3, name: 'Tim', steam_nickname: 'RedLetter' })];
  const demoPlayers = [{ steamId: '333', name: 'RedLetter' }];
  const warnings: string[] = [];
  const resolved = resolveRoster(demoPlayers, roster, warnings);
  assert.deepEqual(resolved.get('333'), { player_id: 3, faction: 'SHIRTS' });
});

test('resolveRoster: pass 3 resolves the single remaining player by elimination and warns', () => {
  const roster: RosterEntry[] = [
    slot({ player_id: 1, steam_id: '111', name: 'Tim' }),
    slot({ player_id: 2, steam_id: null, name: 'Unmatched Guy' }),
  ];
  const demoPlayers = [
    { steamId: '111', name: 'Tim' },
    { steamId: '999', name: 'SomeAlias' }, // no steam id or name match -> only one open slot left
  ];
  const warnings: string[] = [];
  const resolved = resolveRoster(demoPlayers, roster, warnings);
  assert.deepEqual(resolved.get('999'), { player_id: 2, faction: 'SHIRTS' });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /by elimination/);
});

test('resolveRoster: throws listing every unmatched player when more than one is ambiguous', () => {
  const roster: RosterEntry[] = [
    slot({ player_id: 1, steam_id: '111', name: 'Tim' }),
    slot({ player_id: 2, name: 'Open Slot A' }),
    slot({ player_id: 3, name: 'Open Slot B' }),
  ];
  const demoPlayers = [
    { steamId: '111', name: 'Tim' },
    { steamId: '888', name: 'Stranger1' },
    { steamId: '999', name: 'Stranger2' },
  ];
  assert.throws(
    () => resolveRoster(demoPlayers, roster, []),
    /Could not match 2 demo player\(s\)/,
  );
});

test('resolveRoster: duplicate steam ids on the roster do not double-assign the same slot', () => {
  const roster: RosterEntry[] = [
    slot({ player_id: 1, steam_id: '111', name: 'Tim', faction: 'SHIRTS' }),
    slot({ player_id: 2, steam_id: '222', name: 'Dan', faction: 'SKINS' }),
  ];
  const demoPlayers = [
    { steamId: '111', name: 'Tim' },
    { steamId: '222', name: 'Dan' },
  ];
  const resolved = resolveRoster(demoPlayers, roster, []);
  assert.equal(resolved.size, 2);
  assert.equal(resolved.get('111')?.player_id, 1);
  assert.equal(resolved.get('222')?.player_id, 2);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
