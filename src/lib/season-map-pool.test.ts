import { test, expect } from 'vitest';
import { parseMapPoolInput } from './season-map-pool';

const URL = 'https://steamcommunity.com/sharedfiles/filedetails/?id=123';

test('parseMapPoolInput: rejects non-string new-map names and URLs instead of throwing', () => {
  for (const bad of [{ name: 123, workshopUrl: URL }, { name: 'x', workshopUrl: 5 }, null, { name: ' ', workshopUrl: URL }]) {
    const res = parseMapPoolInput({ new_maps: [bad] });
    expect(res.ok).toBe(false);
  }
});

test('parseMapPoolInput: accepts a well-formed new map', () => {
  const res = parseMapPoolInput({ new_maps: [{ name: 'Foo', workshopUrl: URL }] });
  expect(res).toEqual({ ok: true, mapPool: null, newMaps: [{ name: 'Foo', workshopUrl: URL }] });
});
