/**
 * Unit tests for the pure replay primitives — projection math and per-tick state
 * derivation. These power BOTH the browser player and the headless mp4 render, so a
 * regression here silently corrupts every replay and every future map heatmap. Lock
 * the invariants: y-flip, aspect-preserved auto-fit, the calibrated radar transform,
 * frame interpolation, angular wrap, and the event/grenade time windows.
 *
 * Run (mirrors util.test.ts — no framework, just node:assert):
 *   npx tsx src/lib/replay/replay.test.ts
 */

import assert from 'node:assert/strict';
import {
  autoFitProjector,
  calibratedProjector,
  payloadBounds,
  type Bounds,
} from './project';
import {
  interpolatePlayers,
  bombStateAt,
  killFeedAt,
  tracersAt,
  activeGrenadesAt,
  roundTickRange,
} from './playback';
import { buildHeatmapPoints } from './heatmap';
import { parseOverview, workshopIdFromUrl } from './radar';
import type { ReplayRound, ReplayFrame, ReplayPayload, ReplayPlayerFrame } from './types';

let passed = 0;
const failures: string[] = [];

function approx(actual: number, expected: number, msg?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-6, msg ?? `expected ~${expected}, got ${actual}`);
}

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${(err as Error).message.replace(/\n/g, '\n    ')}`);
  }
}

// --- helpers to build minimal fixtures ---
function pf(id: number, x: number, y: number, extra: Partial<ReplayPlayerFrame> = {}): ReplayPlayerFrame {
  return {
    id,
    x,
    y,
    yaw: extra.yaw ?? 0,
    hp: extra.hp ?? 100,
    alive: extra.alive ?? true,
    weapon: extra.weapon ?? null,
  };
}
function frame(tick: number, players: ReplayPlayerFrame[]): ReplayFrame {
  return { tick, players, bomb: null };
}
function round(partial: Partial<ReplayRound>): ReplayRound {
  return {
    round: 1,
    startTick: 0,
    endTick: 1000,
    sideByFaction: { SHIRTS: 'CT', SKINS: 'T' },
    frames: [],
    events: [],
    grenades: [],
    ...partial,
  };
}

// --- autoFitProjector: y-flip + corner mapping ---
test('autoFit: world top-left maps to canvas top-left, with y flipped', () => {
  const bounds: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const proj = autoFitProjector(bounds, 200, 200, 0);
  // world (0,100) is the NORTH-WEST corner → canvas (0,0)
  let p = proj.project({ x: 0, y: 100 });
  approx(p.x, 0);
  approx(p.y, 0);
  // world (100,0) is the SOUTH-EAST corner → canvas (200,200)
  p = proj.project({ x: 100, y: 0 });
  approx(p.x, 200);
  approx(p.y, 200);
});

test('autoFit: preserves aspect ratio (uniform scale) and centers', () => {
  // Wide world box in a square canvas → letterboxed vertically.
  const bounds: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
  const proj = autoFitProjector(bounds, 200, 200, 0);
  // scale = min(200/100, 200/50) = 2 (x-limited). drawnH = 50*2 = 100, centered → offsetY 50.
  const p = proj.project({ x: 0, y: 50 }); // top-left of box
  approx(p.x, 0);
  approx(p.y, 50);
  approx(proj.scaleLength(10), 20);
});

// --- calibratedProjector: standard radar transform ---
test('calibrated: world→image px with downward y', () => {
  const proj = calibratedProjector(
    { posX: 0, posY: 0, scale: 1, imageWidth: 100, imageHeight: 100 },
    100,
    100,
  );
  approx(proj.project({ x: 0, y: 0 }).x, 0);
  approx(proj.project({ x: 0, y: 0 }).y, 0);
  // world y decreases downward in image space: (50,-50) → image (50,50)
  const p = proj.project({ x: 50, y: -50 });
  approx(p.x, 50);
  approx(p.y, 50);
});

// --- payloadBounds ---
test('payloadBounds: spans all player + grenade positions', () => {
  const payload = {
    rounds: [
      round({
        frames: [frame(0, [pf(1, -10, 5), pf(2, 30, 40)])],
        grenades: [{ type: 'smoke', throwerId: 1, detonateTick: 10, trajectory: [{ tick: 5, x: 50, y: -20, z: 0 }] }],
      }),
    ],
  } as unknown as ReplayPayload;
  const b = payloadBounds(payload)!;
  approx(b.minX, -10);
  approx(b.maxX, 50);
  approx(b.minY, -20);
  approx(b.maxY, 40);
});

test('payloadBounds: null when there are no positions', () => {
  const payload = { rounds: [round({ frames: [], grenades: [] })] } as unknown as ReplayPayload;
  assert.equal(payloadBounds(payload), null);
});

// --- interpolatePlayers: linear lerp between downsampled frames ---
test('interpolate: midpoint position is the average of bounding frames', () => {
  const r = round({ frames: [frame(0, [pf(1, 0, 0)]), frame(64, [pf(1, 100, 200)])] });
  const at = interpolatePlayers(r, 32);
  approx(at[0].x, 50);
  approx(at[0].y, 100);
});

test('interpolate: clamps before first and after last frame', () => {
  const r = round({ frames: [frame(10, [pf(1, 5, 5)]), frame(70, [pf(1, 9, 9)])] });
  approx(interpolatePlayers(r, 0)[0].x, 5); // before start → first frame
  approx(interpolatePlayers(r, 999)[0].x, 9); // after end → last frame
});

test('interpolate: yaw takes the shortest angular path across 0°', () => {
  const r = round({
    frames: [frame(0, [pf(1, 0, 0, { yaw: 10 })]), frame(64, [pf(1, 0, 0, { yaw: 350 })])],
  });
  // 10° → 350° is a -20° turn through 0, not +340°. Midpoint = 0°.
  approx(interpolatePlayers(r, 32)[0].yaw, 0);
});

// --- bombStateAt: reconstructed from plant/defuse events ---
test('bomb: none before plant, planted at site after, defused after defuse', () => {
  const r = round({
    events: [
      { type: 'plant', tick: 100, playerId: 1, site: 'A', x: 7, y: 8 },
      { type: 'defuse', tick: 300, playerId: 2, x: 7, y: 8 },
    ],
  });
  assert.equal(bombStateAt(r, 50), null);
  const planted = bombStateAt(r, 200)!;
  assert.equal(planted.planted, true);
  assert.equal(planted.defused, false);
  approx(planted.x, 7);
  assert.equal(bombStateAt(r, 400)!.defused, true);
});

// --- killFeed / tracers windows ---
test('killFeed: only kills within the recent window, newest first', () => {
  const tickRate = 64;
  const r = round({
    events: [
      { type: 'kill', tick: 100, attackerId: 1, victimId: 2, assisterId: null, weapon: 'weapon_ak47', headshot: false, attacker: { x: 0, y: 0 }, victim: { x: 1, y: 1 } },
      { type: 'kill', tick: 500, attackerId: 3, victimId: 4, assisterId: null, weapon: 'weapon_awp', headshot: true, attacker: { x: 2, y: 2 }, victim: { x: 3, y: 3 } },
    ],
  });
  // At tick 520, the older kill (tick 100) is >6s old and drops out.
  const feed = killFeedAt(r, 520, tickRate);
  assert.equal(feed.length, 1);
  assert.equal(feed[0].victimId, 4);
});

test('tracers: fade from 1 to 0 across the tracer window, then disappear', () => {
  const tickRate = 64;
  const r = round({
    events: [
      { type: 'kill', tick: 100, attackerId: 1, victimId: 2, assisterId: null, weapon: null, headshot: false, attacker: { x: 0, y: 0 }, victim: { x: 10, y: 0 } },
    ],
  });
  approx(tracersAt(r, 100, tickRate)[0].alpha, 1); // at the kill
  assert.equal(tracersAt(r, 100 + 64, tickRate).length, 0); // 1s later (>0.8s window) gone
});

// --- activeGrenades: visible in flight, lingers as effect after detonation ---
test('grenades: in flight then detonated effect, gone after linger', () => {
  const tickRate = 64;
  const r = round({
    grenades: [
      { type: 'smoke', throwerId: 1, detonateTick: 200, trajectory: [{ tick: 100, x: 0, y: 0, z: 0 }, { tick: 200, x: 50, y: 50, z: 0 }] },
    ],
  });
  assert.equal(activeGrenadesAt(r, 50, tickRate).length, 0); // before throw
  assert.equal(activeGrenadesAt(r, 150, tickRate)[0].detonated, false); // mid-flight
  assert.equal(activeGrenadesAt(r, 200, tickRate)[0].detonated, true); // at detonation
  assert.equal(activeGrenadesAt(r, 200 + 2 * tickRate, tickRate).length, 0); // past linger
});

test('roundTickRange: spans first to last frame tick', () => {
  const r = round({ frames: [frame(10, []), frame(20, []), frame(90, [])] });
  const range = roundTickRange(r);
  assert.equal(range.start, 10);
  assert.equal(range.end, 90);
});

// --- buildHeatmapPoints: kill→death+kill points, grenade→detonation point ---
test('heatmap: a kill yields a death point (victim) and a kill point (attacker), side-tagged', () => {
  const payload = {
    matchId: 7,
    map: 'de_test',
    players: [
      { id: 1, name: 'A', faction: 'SHIRTS', steamId: null },
      { id: 2, name: 'B', faction: 'SKINS', steamId: null },
    ],
    rounds: [
      round({
        sideByFaction: { SHIRTS: 'CT', SKINS: 'T' },
        events: [
          {
            type: 'kill',
            tick: 100,
            attackerId: 1,
            victimId: 2,
            assisterId: null,
            weapon: 'weapon_ak47',
            headshot: false,
            attacker: { x: 10, y: 20 },
            victim: { x: 30, y: 40 },
          },
        ],
      }),
    ],
  } as unknown as ReplayPayload;

  const art = buildHeatmapPoints(payload);
  assert.equal(art.version, 1);
  const death = art.points.find((p) => p.kind === 'death')!;
  const kill = art.points.find((p) => p.kind === 'kill')!;
  approx(death.x, 30);
  approx(death.y, 40);
  assert.equal(death.side, 'T'); // victim is SKINS = T this round
  approx(kill.x, 10);
  assert.equal(kill.side, 'CT'); // attacker is SHIRTS = CT this round
});

test('heatmap: grenade contributes a detonation point of its type; unknown is skipped', () => {
  const payload = {
    matchId: 7,
    map: 'de_test',
    players: [{ id: 1, name: 'A', faction: 'SHIRTS', steamId: null }],
    rounds: [
      round({
        sideByFaction: { SHIRTS: 'T', SKINS: 'CT' },
        grenades: [
          { type: 'smoke', throwerId: 1, detonateTick: 200, trajectory: [{ tick: 100, x: 0, y: 0, z: 0 }, { tick: 200, x: 55, y: 66, z: 0 }] },
          { type: 'unknown', throwerId: 1, detonateTick: 200, trajectory: [{ tick: 100, x: 1, y: 1, z: 0 }] },
        ],
      }),
    ],
  } as unknown as ReplayPayload;

  const art = buildHeatmapPoints(payload);
  const smoke = art.points.filter((p) => p.kind === 'smoke');
  assert.equal(smoke.length, 1);
  approx(smoke[0].x, 55); // detonation = last trajectory point
  assert.equal(smoke[0].side, 'T');
  assert.equal(art.points.some((p) => (p.kind as string) === 'unknown'), false);
});

// --- radar: overview parsing + workshop id extraction ---
test('parseOverview: reads pos_x/pos_y/scale and material from CS KeyValues', () => {
  const txt = `
    "de_example"
    {
      "material"  "overviews/de_example_radar_psd"
      "pos_x"   "-2476"
      "pos_y"   "3239"
      "scale"   "5.0"
    }
  `;
  const cal = parseOverview(txt)!;
  approx(cal.posX, -2476);
  approx(cal.posY, 3239);
  approx(cal.scale, 5.0);
  assert.equal(cal.material, 'overviews/de_example_radar_psd');
});

test('parseOverview: reads the CS2 KV3 form (unquoted, = separator, decimals)', () => {
  const txt = `<!-- kv3 -->
    {
      material = "materials/overviews/de_foroglio.vmat"
      pos_x = -2476.000000
      pos_y = 3239.000000
      scale = 5.000000
    }
  `;
  const cal = parseOverview(txt)!;
  approx(cal.posX, -2476);
  approx(cal.posY, 3239);
  approx(cal.scale, 5);
  assert.equal(cal.material, 'materials/overviews/de_foroglio.vmat');
});

test('parseOverview: null when a required key or a usable scale is missing', () => {
  assert.equal(parseOverview('"x" { "pos_x" "1" "pos_y" "2" }'), null); // no scale
  assert.equal(parseOverview('"x" { "pos_x" "1" "pos_y" "2" "scale" "0" }'), null); // scale 0
});

test('workshopIdFromUrl: pulls the id from ?id= and from a bare digit run', () => {
  assert.equal(workshopIdFromUrl('https://steamcommunity.com/sharedfiles/filedetails/?id=3070284539'), '3070284539');
  assert.equal(workshopIdFromUrl('steam://url/CommunityFilePage/3070284539'), '3070284539');
  assert.equal(workshopIdFromUrl(null), null);
});

// --- report ---
if (failures.length) {
  console.error(`\n✗ ${failures.length} replay test(s) failed:\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  console.error(`(${passed} passed)`);
  process.exit(1);
} else {
  console.log(`✓ all ${passed} replay tests passed`);
}
