/** A season's buy-in is a dollar amount: 0–999.99, at most two decimals (the `buy_in_amount`
 * column is `numeric(5, 2)`). `null` means TBD. */
const MAX_BUY_IN = 999.99;

export type BuyInAmount = { ok: true; amount: number } | { ok: false; error: string };
export type BuyInInput = { ok: true; amount: number | null } | { ok: false; error: string };

/** The one buy-in amount rule every other check here derives from: a finite number from 0 to
 * `MAX_BUY_IN` with at most two decimal places. Returns `amount: 0` for a free season; rejects
 * negatives, non-numbers, and anything the column can't store exactly. */
export function parseBuyInAmount(raw: unknown): BuyInAmount {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { ok: false, error: 'buy_in_amount must be a number' };
  }
  const cents = Math.round(raw * 100);
  if (Math.abs(raw * 100 - cents) > 1e-6) {
    return { ok: false, error: 'buy_in_amount can have at most two decimal places' };
  }
  const amount = cents / 100;
  if (amount < 0 || amount > MAX_BUY_IN) {
    return { ok: false, error: `buy_in_amount must be between 0 and ${MAX_BUY_IN}` };
  }
  return { ok: true, amount };
}

/** Validates a request body's `buy_in_amount` where it's optional: absent or `null` means TBD and
 * comes back as `amount: null`; anything else must pass `parseBuyInAmount()`. */
export function parseBuyInInput(body: unknown): BuyInInput {
  const raw = (body as { buy_in_amount?: unknown } | null)?.buy_in_amount;
  return raw == null ? { ok: true, amount: null } : parseBuyInAmount(raw);
}

/** `$10` for whole amounts, `$7.50` otherwise. */
export function formatBuyIn(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** Client-side check for a buy-in text input: plain decimal digits (no sign, exponent or blank —
 * forms `Number()` would otherwise accept) whose value passes `parseBuyInAmount()`. */
export function isValidBuyInText(text: string): boolean {
  return /^\d+(\.\d+)?$/.test(text.trim()) && parseBuyInAmount(Number(text)).ok;
}
