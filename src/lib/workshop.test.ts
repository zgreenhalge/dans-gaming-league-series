import { test, expect } from 'vitest';
import { isValidWorkshopUrl, workshopIdFromInput, workshopIdFromUrl } from './workshop';

const URL = 'https://steamcommunity.com/sharedfiles/filedetails/?id=3070284539';

test('workshopIdFromUrl: reads the id query parameter wherever it sits in the query', () => {
  expect(workshopIdFromUrl(URL)).toBe('3070284539');
  expect(workshopIdFromUrl(`${URL}&searchtext=brewery`)).toBe('3070284539');
  expect(workshopIdFromUrl('https://steamcommunity.com/sharedfiles/filedetails/?foo=1&id=5')).toBe('5');
  expect(workshopIdFromUrl(`${URL}#reviews`)).toBe('3070284539');
});

test('workshopIdFromUrl: null for a missing link, a missing or malformed id, or no id parameter', () => {
  expect(workshopIdFromUrl(null)).toBeNull();
  expect(workshopIdFromUrl(undefined)).toBeNull();
  expect(workshopIdFromUrl('')).toBeNull();
  expect(workshopIdFromUrl('https://steamcommunity.com/sharedfiles/filedetails/')).toBeNull();
  expect(workshopIdFromUrl('https://steamcommunity.com/sharedfiles/filedetails/?id=')).toBeNull();
  expect(workshopIdFromUrl(`${URL}abc`)).toBeNull();
  expect(workshopIdFromUrl('steam://url/CommunityFilePage/3070284539')).toBeNull();
});

test('workshopIdFromInput: a link, a bare id, or a steam:// link all resolve', () => {
  expect(workshopIdFromInput(URL)).toBe('3070284539');
  expect(workshopIdFromInput('3070284539')).toBe('3070284539');
  expect(workshopIdFromInput('steam://url/CommunityFilePage/3070284539')).toBe('3070284539');
  expect(workshopIdFromInput(null)).toBeNull();
  expect(workshopIdFromInput('12345')).toBeNull();
  expect(workshopIdFromInput('')).toBeNull();
});

test('isValidWorkshopUrl: accepts the www and /workshop/ item pages and trims', () => {
  for (const ok of [
    URL,
    'https://www.steamcommunity.com/sharedfiles/filedetails/?id=123',
    'https://steamcommunity.com/workshop/filedetails/?id=123',
    'https://steamcommunity.com/sharedfiles/filedetails?id=123',
    'https://steamcommunity.com/sharedfiles/filedetails/?id=123&searchtext=foo',
    'https://steamcommunity.com/sharedfiles/filedetails/?foo=1&id=123',
    `  ${URL}  `,
  ]) {
    expect(isValidWorkshopUrl(ok)).toBe(true);
  }
});

test('isValidWorkshopUrl: rejects other hosts, schemes, pages and malformed ids', () => {
  for (const bad of [
    '',
    'steamcommunity.com/sharedfiles/filedetails/?id=1',
    'http://steamcommunity.com/sharedfiles/filedetails/?id=1',
    'https://example.com/?id=1',
    'https://steamcommunity.com/id/someone/?id=1',
    'https://steamcommunity.com/sharedfiles/filedetails/?id=',
    `${URL}abc`,
  ]) {
    expect(isValidWorkshopUrl(bad)).toBe(false);
  }
});

test('isValidWorkshopUrl and workshopIdFromUrl agree: a valid link always yields an id', () => {
  for (const link of [URL, `${URL}&searchtext=x`, 'https://steamcommunity.com/workshop/filedetails/?foo=1&id=9']) {
    expect(isValidWorkshopUrl(link)).toBe(true);
    expect(workshopIdFromUrl(link)).not.toBeNull();
  }
});
