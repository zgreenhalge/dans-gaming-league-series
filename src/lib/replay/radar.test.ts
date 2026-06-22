/**
 * Unit tests for the pure radar-build helpers — the deterministic parsing the
 * SteamCMD/Source2Viewer orchestration feeds into. A regression here mis-places every
 * radar (wrong offset/scale) or fails to find the workshop item, so lock the format
 * handling down.
 *
 * Run (mirrors util.test.ts — no framework, just node:assert):
 *   npx tsx src/lib/replay/radar.test.ts
 */

import assert from 'node:assert/strict';
import { parseOverview, workshopIdFromUrl } from './radar';

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
  assert.equal(
    workshopIdFromUrl('https://steamcommunity.com/sharedfiles/filedetails/?id=3070284539'),
    '3070284539',
  );
  assert.equal(workshopIdFromUrl('steam://url/CommunityFilePage/3070284539'), '3070284539');
  assert.equal(workshopIdFromUrl(null), null);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} radar test(s) failed:\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  console.error(`(${passed} passed)`);
  process.exit(1);
} else {
  console.log(`✓ all ${passed} radar tests passed`);
}
