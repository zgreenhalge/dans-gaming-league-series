import { test, expect } from 'vitest';
import { parseBuyInText, parseBuyInAmount, parseBuyInInput } from './season-buy-in';

test('parseBuyInAmount: accepts 0–999.99 with at most two decimals', () => {
  expect(parseBuyInAmount(0)).toEqual({ ok: true, amount: 0 });
  expect(parseBuyInAmount(7.5)).toEqual({ ok: true, amount: 7.5 });
  expect(parseBuyInAmount(0.29)).toEqual({ ok: true, amount: 0.29 });
  expect(parseBuyInAmount(999.99)).toEqual({ ok: true, amount: 999.99 });
});

test('parseBuyInAmount: rejects non-numbers, out-of-range and over-precise amounts', () => {
  for (const bad of [undefined, null, '5', NaN, Infinity, -0.01, 1000, 999.994, 1.234]) {
    expect(parseBuyInAmount(bad).ok).toBe(false);
  }
});

test('parseBuyInInput: an absent or null buy_in_amount is TBD', () => {
  expect(parseBuyInInput({})).toEqual({ ok: true, amount: null });
  expect(parseBuyInInput(null)).toEqual({ ok: true, amount: null });
  expect(parseBuyInInput({ buy_in_amount: null })).toEqual({ ok: true, amount: null });
  expect(parseBuyInInput({ buy_in_amount: 10 })).toEqual({ ok: true, amount: 10 });
  expect(parseBuyInInput({ buy_in_amount: -1 }).ok).toBe(false);
});

test('parseBuyInText: blank is TBD and 0 is a free season', () => {
  expect(parseBuyInText('')).toEqual({ ok: true, amount: null });
  expect(parseBuyInText(' ')).toEqual({ ok: true, amount: null });
  expect(parseBuyInText('0')).toEqual({ ok: true, amount: 0 });
});

test('parseBuyInText: agrees with parseBuyInAmount on every plain decimal', () => {
  for (const text of ['0', '10', '7.5', '7.50', '999.99', '1.234', '999.994', '1000']) {
    expect(parseBuyInText(text)).toEqual(parseBuyInAmount(Number(text)));
  }
});

test('parseBuyInText: rejects text Number() would accept but is not a plain amount', () => {
  for (const text of ['1e2', '-1', '0x10', '.5', '5.']) {
    expect(parseBuyInText(text).ok).toBe(false);
  }
});
