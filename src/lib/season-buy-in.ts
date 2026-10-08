/** A season's buy-in is a dollar amount: 0–999.99, at most two decimals (the `buy_in_amount`
 * column is `numeric(5, 2)`). */
const MAX_BUY_IN = 999.99;

export type BuyInInput = { ok: true; amount: number } | { ok: false; error: string };

/** Validates a request body's `buy_in_amount`. Returns `amount: 0` for a free season; rejects
 * negatives, non-numbers, and anything the column can't store. */
export function parseBuyInInput(body: unknown): BuyInInput {
  const raw = (body as { buy_in_amount?: unknown } | null)?.buy_in_amount;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { ok: false, error: 'buy_in_amount must be a number' };
  }
  const amount = Math.round(raw * 100) / 100;
  if (amount < 0 || amount > MAX_BUY_IN) {
    return { ok: false, error: `buy_in_amount must be between 0 and ${MAX_BUY_IN}` };
  }
  return { ok: true, amount };
}

/** `$10` for whole amounts, `$7.50` otherwise. */
export function formatBuyIn(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** Client-side check for a buy-in text input: plain decimal digits with at most two places, within
 * the range `parseBuyInInput()` enforces. */
export function isValidBuyInText(text: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(text.trim()) && parseBuyInInput({ buy_in_amount: Number(text) }).ok;
}
