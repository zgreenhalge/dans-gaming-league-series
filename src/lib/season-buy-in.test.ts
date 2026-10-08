import { test, expect } from 'vitest';
import { isValidBuyInText, parseBuyInAmount, parseBuyInInput } from './season-buy-in';

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

test('isValidBuyInText: agrees with parseBuyInAmount on every plain decimal', () => {
  for (const text of ['0', '10', '7.5', '7.50', '999.99', '1.234', '999.994', '1000']) {
    expect(isValidBuyInText(text)).toBe(parseBuyInAmount(Number(text)).ok);
  }
});

test('isValidBuyInText: rejects text Number() would accept but is not a plain amount', () => {
  for (const text of ['', ' ', '1e2', '-1', '0x10', '.5', '5.']) {
    expect(isValidBuyInText(text)).toBe(false);
  }
});
