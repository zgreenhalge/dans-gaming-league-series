/**
 * Unit tests for extractRecolorableSvg() — the upstream-SVG-to-minimal-tintable-SVG transform
 * shared by scripts/sync-icons.ts (which fetches and re-extracts) and every file committed under
 * public/{round,grenade,side,kill,weapon}-icons/ (which must already equal this function's own
 * output — see the idempotency test below for why).
 *
 * Run:  npx vitest run src/lib/svgExtract.test.ts
 */

import assert from 'node:assert/strict';
import { extractRecolorableSvg } from './svgExtract';
import { test, report } from './test-support/miniTest';

// A synthetic stand-in for a real Illustrator/Source2Viewer export: XML prolog, DOCTYPE, generator
// comment, nested <g> wrappers, an unrelated <g id="guides"> that should be dropped along with any
// non-shape content, and shape attributes in a different order than ATTR_ORDER expects.
const SAMPLE_UPSTREAM = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator 16.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="10px" height="10px"
  viewBox="0 0 10 10" enable-background="new 0 0 10 10" xml:space="preserve">
<g id="guides"></g>
<g id="Selected_Items">
  <g>
    <path d="M0,0L10,10" fill="#ff0000" fill-rule="evenodd" clip-rule="evenodd"/>
  </g>
</g>
</svg>
`;

test('extractRecolorableSvg: forces every shape fill to currentColor', () => {
  const { svg } = extractRecolorableSvg(SAMPLE_UPSTREAM);
  assert.match(svg, /fill="currentColor"/);
  assert.doesNotMatch(svg, /fill="#ff0000"/);
});

test('extractRecolorableSvg: strips the XML prolog, DOCTYPE, comments, and <g> wrappers', () => {
  const { svg } = extractRecolorableSvg(SAMPLE_UPSTREAM);
  assert.doesNotMatch(svg, /<\?xml/);
  assert.doesNotMatch(svg, /<!DOCTYPE/);
  assert.doesNotMatch(svg, /Generator/);
  assert.doesNotMatch(svg, /<g/);
});

test('extractRecolorableSvg: reports the viewBox width/height', () => {
  const { width, height } = extractRecolorableSvg(SAMPLE_UPSTREAM);
  assert.equal(width, 10);
  assert.equal(height, 10);
});

test('extractRecolorableSvg: is idempotent — running its own output back through is a no-op', () => {
  // This is the property that broke when public/{weapon,...}-icons/ files were committed via a
  // different, hand-driven extraction method: a real sync run diffs a fresh extraction against
  // the committed file, so if the committed file isn't already in this function's own output
  // format, every icon reports as "changed" on every run, regardless of whether upstream moved at
  // all. Feeding this function's own output back into itself must reproduce it exactly.
  const once = extractRecolorableSvg(SAMPLE_UPSTREAM).svg;
  const twice = extractRecolorableSvg(once).svg;
  assert.equal(twice, once);
});

report();
