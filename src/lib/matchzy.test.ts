/**
 * Unit tests for matchzy.ts's buildMatchzyConfig (#163) — the MatchZy match-config JSON assembly
 * shared by scripts/gen-matchzy-config.ts and the authenticated matchzy-config API route.
 * buildMatchzyConfig takes its SupabaseClient as a parameter (no shared/global client), so it's
 * testable end-to-end against an in-memory fake DB with no network or module-level mocking —
 * see src/lib/test-support/fakeSupabase.ts, the same harness the queries.ts regression tests use.
 *
 * Run:  npx tsx src/lib/matchzy.test.ts
 */

import assert from 'node:assert/strict';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import type { FakeDb } from './test-support/fakeSupabase';
import { buildMatchzyConfig, demoBaseName, matchIdFromDemoBaseName } from './matchzy';
import { test, report } from './test-support/miniTest';

/** A minimal, valid one-match DB: match 500, shirts/skins each with one rostered player, plus one
 *  known league player who isn't in the roster (a spectator candidate). Overridable per test via
 *  `overrides` so each test only states what it's varying. */
function buildDb(overrides: Partial<{ match: FakeDb['matches'][number] }> = {}): FakeDb {
  return {
    matches: [
      {
        id: 500,
        shirts_pick: null,
        picked_map: 'de_such',
        skins_starting_side: 'CT',
        scheduled_at: '2026-08-04T23:00:00+00:00',
        week_id: 1,
        ...overrides.match,
      },
    ],
    weeks: [{ id: 1, season_id: 1 }],
    seasons: [{ id: 1, target_win_rounds: 13, is_gauntlet: false }],
    player_match_stats: [
      { match_id: 500, player_id: 10, faction: 'SHIRTS' },
      { match_id: 500, player_id: 11, faction: 'SKINS' },
    ],
    players: [
      { id: 10, name: 'Player A', steam_id: '76561100000000010', steam_nickname: 'AAA' },
      { id: 11, name: 'Player B', steam_id: '76561100000000011', steam_nickname: null },
      { id: 12, name: 'Player C', steam_id: '76561100000000012', steam_nickname: 'Ccc' },
    ],
  };
}

async function main() {
  await test('rosters both teams by steamid64, keyed off faction', async () => {
    const client = createFakeSupabaseClient(buildDb());
    const { config } = await buildMatchzyConfig(client, 500);
    assert.deepEqual(config.team1.players, { '76561100000000010': 'AAA' });
    assert.deepEqual(config.team2.players, { '76561100000000011': 'Player B' }); // no nickname -> falls back to name
  });

  await test('spectators = every known player minus whoever is already rostered', async () => {
    const client = createFakeSupabaseClient(buildDb());
    const { config } = await buildMatchzyConfig(client, 500);
    assert.deepEqual(config.spectators.players, { '76561100000000012': 'Ccc' });
  });

  await test('a rostered player with no steam_id is omitted from their team and warned about', async () => {
    const db = buildDb();
    db.players = [
      { id: 10, name: 'Player A', steam_id: null, steam_nickname: null },
      { id: 11, name: 'Player B', steam_id: '76561100000000011', steam_nickname: null },
    ];
    const client = createFakeSupabaseClient(db);
    const { config, warnings } = await buildMatchzyConfig(client, 500);
    assert.deepEqual(config.team1.players, {});
    assert.ok(warnings.some((w) => /without a steam_id.*SHIRTS:Player A/.test(w)), warnings.join('; '));
  });

  await test('map_sides: skins starting side determines which team is forced CT', async () => {
    const cases: Array<['CT' | 'T', string]> = [
      ['CT', 'team2_ct'], // skins start CT
      ['T', 'team1_ct'], // skins start T -> shirts CT
    ];
    for (const [skinsSide, expected] of cases) {
      const client = createFakeSupabaseClient(buildDb({ match: { skins_starting_side: skinsSide } }));
      const { config } = await buildMatchzyConfig(client, 500);
      assert.deepEqual(config.map_sides, [expected], `skins_starting_side=${skinsSide}`);
    }
  });

  await test('map_sides: side not yet set -> ["knife"] and a warning', async () => {
    const client = createFakeSupabaseClient(buildDb({ match: { skins_starting_side: null } }));
    const { config, warnings } = await buildMatchzyConfig(client, 500);
    assert.deepEqual(config.map_sides, ['knife']);
    assert.ok(warnings.some((w) => /skins_starting_side not set/.test(w)), warnings.join('; '));
  });

  await test('maplist prefers shirts_pick over picked_map, falling back when unset', async () => {
    const cases: Array<[string | null, string | null, string]> = [
      ['de_picked_by_shirts', 'de_such', 'de_picked_by_shirts'], // shirts_pick wins
      [null, 'de_such', 'de_such'], // falls back to picked_map
    ];
    for (const [shirtsPick, pickedMap, expected] of cases) {
      const client = createFakeSupabaseClient(
        buildDb({ match: { shirts_pick: shirtsPick, picked_map: pickedMap } }),
      );
      const { config } = await buildMatchzyConfig(client, 500);
      assert.deepEqual(config.maplist, [expected], `shirts_pick=${shirtsPick}, picked_map=${pickedMap}`);
    }
  });

  await test('no picked map at all -> empty maplist and a warning', async () => {
    const client = createFakeSupabaseClient(
      buildDb({ match: { shirts_pick: null, picked_map: null } }),
    );
    const { config, warnings } = await buildMatchzyConfig(client, 500);
    assert.deepEqual(config.maplist, []);
    assert.ok(warnings.some((w) => /no picked map/.test(w)), warnings.join('; '));
  });

  await test('maplistOverride wins over both shirts_pick and picked_map', async () => {
    const client = createFakeSupabaseClient(
      buildDb({ match: { shirts_pick: 'de_picked_by_shirts', picked_map: 'de_such' } }),
    );
    const { config } = await buildMatchzyConfig(client, 500, { maplistOverride: 'workshop/123/de_override' });
    assert.deepEqual(config.maplist, ['workshop/123/de_override']);
  });

  await test('cvars carry only the demo name format when no remote-log option is passed', async () => {
    const client = createFakeSupabaseClient(buildDb());
    const { config } = await buildMatchzyConfig(client, 500);
    assert.deepEqual(config.cvars, { matchzy_demo_name_format: '2026-08-04_500_de-such' });
  });

  await test('a remoteLogUrl without its secret sets the header key but not the header value', async () => {
    const client = createFakeSupabaseClient(buildDb());
    const { config } = await buildMatchzyConfig(client, 500, { remoteLogUrl: 'https://worker.example/log' });
    assert.deepEqual(config.cvars, {
      matchzy_demo_name_format: '2026-08-04_500_de-such',
      matchzy_remote_log_url: 'https://worker.example/log',
      matchzy_remote_log_header_key: 'X-MatchZy-Token',
    });
  });

  await test('remoteLogUrl + remoteLogSecret populate the full cvar pair', async () => {
    const client = createFakeSupabaseClient(buildDb());
    const { config } = await buildMatchzyConfig(client, 500, {
      remoteLogUrl: 'https://worker.example/log',
      remoteLogSecret: 'log-secret',
    });
    assert.deepEqual(config.cvars, {
      matchzy_demo_name_format: '2026-08-04_500_de-such',
      matchzy_remote_log_url: 'https://worker.example/log',
      matchzy_remote_log_header_key: 'X-MatchZy-Token',
      matchzy_remote_log_header_value: 'log-secret',
    });
  });

  await test('matchzy_demo_name_format uses shirts_pick over picked_map, matching maplist precedence', async () => {
    const client = createFakeSupabaseClient(
      buildDb({ match: { shirts_pick: 'de_picked_by_shirts', picked_map: 'de_such' } }),
    );
    const { config } = await buildMatchzyConfig(client, 500);
    assert.equal(config.cvars.matchzy_demo_name_format, '2026-08-04_500_de-picked-by-shirts');
  });

  await test('matchzy_demo_name_format ignores maplistOverride (a workshop id, not a demo-name-worthy map slug)', async () => {
    const client = createFakeSupabaseClient(buildDb());
    const { config } = await buildMatchzyConfig(client, 500, { maplistOverride: 'workshop/123/de_override' });
    assert.equal(config.maplist[0], 'workshop/123/de_override');
    assert.equal(config.cvars.matchzy_demo_name_format, '2026-08-04_500_de-such');
  });

  await test('demoBaseName() — matches buildMatchzyConfig exactly, so the pull path and the cvar can never drift', () => {
    assert.equal(demoBaseName(500, '2026-08-04T23:00:00+00:00', 'de_such'), '2026-08-04_500_de-such');
  });

  await test('demoBaseName() — falls back to placeholders for an unscheduled match or unset map', () => {
    assert.equal(demoBaseName(500, null, null), 'unscheduled_500_unknown-map');
  });

  await test('matchIdFromDemoBaseName() round-trips demoBaseName() for a scheduled and an unscheduled match', () => {
    assert.equal(matchIdFromDemoBaseName(demoBaseName(500, '2026-08-04T23:00:00+00:00', 'de_such')), 500);
    assert.equal(matchIdFromDemoBaseName(demoBaseName(59, null, 'memento')), 59);
  });

  await test('matchIdFromDemoBaseName() round-trips demoBaseName() even when an all-punctuation map slugifies to empty', () => {
    assert.equal(matchIdFromDemoBaseName(demoBaseName(59, null, '!!!')), 59);
  });

  await test('matchIdFromDemoBaseName() — null for a name in a different shape (e.g. a legacy DatHost-auto or bare-id demo)', () => {
    assert.equal(matchIdFromDemoBaseName('2026-07-20_18-30-00_501_de_such'), null);
    assert.equal(matchIdFromDemoBaseName('54'), null);
    assert.equal(matchIdFromDemoBaseName('not-a-demo-name'), null);
  });

  await test('fixed shape: matchid, num_maps, players_per_team, clinch_series, team names', async () => {
    const client = createFakeSupabaseClient(buildDb());
    const { config } = await buildMatchzyConfig(client, 500);
    assert.equal(config.matchid, 500);
    assert.equal(config.num_maps, 1);
    assert.equal(config.players_per_team, 2);
    assert.equal(config.clinch_series, true);
    assert.equal(config.team1.name, 'SHIRTS');
    assert.equal(config.team2.name, 'SKINS');
  });

  report();
}

main();
