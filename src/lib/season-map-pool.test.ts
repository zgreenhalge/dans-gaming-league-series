import { test, expect, vi } from 'vitest';
import { createFakeSupabaseClient, clientFailingOn, type FakeDb } from './test-support/fakeSupabase';
import { isValidNewMap, parseMapPoolInput, upsertNewMaps } from './season-map-pool';

// Steam is not reached: a map's preview image is the item's `previewUrl`, or null when it has none.
vi.mock('./workshop', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./workshop')>()),
  fetchWorkshopItem: vi.fn(async () => ({ previewUrl: 'https://example.com/preview.jpg' })),
}));

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

test('isValidNewMap: accepts the www and /workshop/ link forms and trims both arguments', () => {
  for (const ok of [
    'https://www.steamcommunity.com/sharedfiles/filedetails/?id=123',
    'https://steamcommunity.com/workshop/filedetails/?id=123',
    'https://steamcommunity.com/sharedfiles/filedetails/?id=123&searchtext=foo',
    `  ${URL}  `,
  ]) {
    expect(isValidNewMap(' Foo ', ok)).toBe(true);
  }
});

test('isValidNewMap: the id must end at & or the end of the string', () => {
  expect(isValidNewMap('Foo', `${URL}abc`)).toBe(false);
  expect(isValidNewMap('Foo', 'https://steamcommunity.com/sharedfiles/filedetails/?id=')).toBe(false);
});

test('isValidNewMap: needs a non-blank name and a Steam Workshop item link', () => {
  expect(isValidNewMap('Foo', URL)).toBe(true);
  expect(isValidNewMap(' ', URL)).toBe(false);
  for (const bad of ['', 'steamcommunity.com/sharedfiles/filedetails/?id=1', 'http://steamcommunity.com/sharedfiles/filedetails/?id=1', 'https://example.com/?id=1']) {
    expect(isValidNewMap('Foo', bad)).toBe(false);
  }
});

test('upsertNewMaps: stores each new map trimmed and lowercased under its slug, with its preview image', async () => {
  const db: FakeDb = { maps: [] };
  await upsertNewMaps(createFakeSupabaseClient(db), [{ name: ' Foo Bar ', workshopUrl: `  ${URL}  ` }]);
  expect(db.maps).toEqual([
    expect.objectContaining({ name: 'foo bar', slug: 'foo-bar', workshop_url: URL, image_url: 'https://example.com/preview.jpg' }),
  ]);
});

test('upsertNewMaps: with no new maps it writes nothing', async () => {
  const db: FakeDb = { maps: [] };
  await upsertNewMaps(createFakeSupabaseClient(db), []);
  expect(db.maps).toEqual([]);
});

test('upsertNewMaps: a failed write throws an Error carrying the database message', async () => {
  const failing = clientFailingOn(createFakeSupabaseClient({ maps: [] }), 'maps', 'upsert', { code: 'TEST', message: 'connection reset' });
  await expect(upsertNewMaps(failing, [{ name: 'Foo', workshopUrl: URL }])).rejects.toThrow('connection reset');
});
