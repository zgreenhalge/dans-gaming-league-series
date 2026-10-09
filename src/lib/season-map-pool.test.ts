import { test, expect } from 'vitest';
import { isValidNewMap, parseMapPoolInput } from './season-map-pool';

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
