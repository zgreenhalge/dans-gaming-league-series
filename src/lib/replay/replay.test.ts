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
  shotTracersAt,
  activeGrenadesAt,
  flashAt,
  hurtAt,
  viewStateAt,
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
    shots: [],
    blinds: [],
    hurts: [],
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

// --- activeGrenades: visible in flight, lingers per-type as effect after detonation ---
test('grenades: smoke in flight → bloom → gone after its ~15s linger', () => {
  const tickRate = 64;
  const r = round({
    grenades: [
      { type: 'smoke', throwerId: 1, detonateTick: 200, trajectory: [{ tick: 100, x: 0, y: 0, z: 0 }, { tick: 200, x: 50, y: 50, z: 0 }] },
    ],
  });
  assert.equal(activeGrenadesAt(r, 50, tickRate).length, 0); // before throw
  assert.equal(activeGrenadesAt(r, 150, tickRate)[0].detonated, false); // mid-flight
  const bloom = activeGrenadesAt(r, 200, tickRate)[0];
  assert.equal(bloom.detonated, true);
  assert.equal(bloom.radius, 144); // smoke AoE
  approx(bloom.fade, 1);
  assert.equal(activeGrenadesAt(r, 200 + 16 * tickRate, tickRate).length, 1); // still up at 16s
  assert.equal(activeGrenadesAt(r, 200 + 19 * tickRate, tickRate).length, 0); // gone after 18s
});

test('grenades: decoy lasts ~15s and pulses (fade dips between fires)', () => {
  const tickRate = 64;
  const r = round({ grenades: [{ type: 'decoy', throwerId: 1, detonateTick: 100, trajectory: [{ tick: 100, x: 0, y: 0, z: 0 }] }] });
  assert.equal(activeGrenadesAt(r, 100 + 14 * tickRate, tickRate).length, 1); // alive at 14s
  assert.equal(activeGrenadesAt(r, 100 + 16 * tickRate, tickRate).length, 0); // gone after 15s
  // Bright at the start of a cycle, dim partway through it.
  const bright = activeGrenadesAt(r, 100, tickRate)[0].fade;
  const dim = activeGrenadesAt(r, 100 + Math.round(0.6 * tickRate), tickRate)[0].fade;
  assert.ok(bright > dim);
});

test('grenades: incendiary covers a larger area than molotov, both burn ~7s', () => {
  const tickRate = 64;
  const traj = [{ tick: 100, x: 0, y: 0, z: 0 }];
  const molo = round({ grenades: [{ type: 'molotov', throwerId: 1, detonateTick: 100, trajectory: traj }] });
  const incen = round({ grenades: [{ type: 'incendiary', throwerId: 1, detonateTick: 100, trajectory: traj }] });
  assert.ok(
    activeGrenadesAt(incen, 100, tickRate)[0].radius > activeGrenadesAt(molo, 100, tickRate)[0].radius,
  );
  assert.equal(activeGrenadesAt(molo, 100 + 6 * tickRate, tickRate).length, 1); // still burning at 6s
  assert.equal(activeGrenadesAt(molo, 100 + 8 * tickRate, tickRate).length, 0); // out after 7s
});

// --- shot tracers: every bullet, cast from the shooter's interpolated frame ---
test('shots: tracer is cast from the live shooter position along their yaw', () => {
  const tickRate = 64;
  const r = round({ shots: [{ tick: 100, shooterId: 1 }] });
  // Shooter at (5,5) facing yaw 0 (+x) at the moment we render.
  const shooter = { id: 1, x: 5, y: 5, yaw: 0, hp: 100, alive: true, flash: 0, hurt: 0 };
  const t = shotTracersAt(r, 100, tickRate, [shooter]);
  assert.equal(t.length, 1);
  approx(t[0].alpha, 1);
  approx(t[0].from.x, 5);
  assert.ok(t[0].to.x > t[0].from.x); // yaw 0 → ray extends along +x (world, no flip here)
  approx(t[0].to.y, 5);
  assert.equal(shotTracersAt(r, 100 + tickRate, tickRate, [shooter]).length, 0); // >0.25s → gone
  // A dead / missing shooter casts no tracer.
  assert.equal(shotTracersAt(r, 100, tickRate, [{ ...shooter, alive: false }]).length, 0);
});

// --- player status effects: flash whiteout + damage blink, per player ---
test('flash: whiteout starts full and fades to 0 over blind_duration', () => {
  const tickRate = 64;
  const r = round({ blinds: [{ tick: 100, playerId: 7, duration: 2 }] });
  approx(flashAt(r, 100, tickRate).get(7)!, 1); // fully blinded at the hit
  approx(flashAt(r, 100 + tickRate, tickRate).get(7)!, 0.5); // halfway through 2s
  assert.equal(flashAt(r, 100 + 3 * tickRate, tickRate).has(7), false); // cleared after duration
});

test('hurt: damage blinks red briefly and re-triggers on the next tick', () => {
  const tickRate = 64;
  const r = round({ hurts: [{ tick: 100, playerId: 7 }, { tick: 132, playerId: 7 }] });
  approx(hurtAt(r, 100, tickRate).get(7)!, 1); // just hit
  // The second hit (tick 132) is the strongest active blink at tick 132.
  approx(hurtAt(r, 132, tickRate).get(7)!, 1);
  assert.equal(hurtAt(r, 200, tickRate).has(7), false); // both >0.5s old → gone
});

test('viewStateAt: status effects land on alive players, not the dead', () => {
  const tickRate = 64;
  const r = round({
    frames: [frame(100, [pf(1, 0, 0, { alive: true }), pf(2, 5, 5, { alive: false })])],
    blinds: [{ tick: 100, playerId: 1, duration: 2 }, { tick: 100, playerId: 2, duration: 2 }],
    hurts: [{ tick: 100, playerId: 1 }],
  });
  const state = viewStateAt(r, 100, tickRate);
  const alive = state.players.find((p) => p.id === 1)!;
  const dead = state.players.find((p) => p.id === 2)!;
  assert.ok(alive.flash > 0 && alive.hurt > 0);
  assert.equal(dead.flash, 0); // dead players show no whiteout
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
