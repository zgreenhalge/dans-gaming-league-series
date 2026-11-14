// Shared button class strings: the admin primary button, plus the small bordered, Cancel, green and
// amber buttons that admin and player-facing controls both use. A plain module (no 'use client') so
// both server and client components can import the strings; one exported from a client module is a
// client reference, not a string, when a server component imports it.

/** The primary admin submit button (form CTAs like "Create Season" or "Confirm & Build") — shares
 * `CONFIRM_VARIANT.primary`'s green scheme at the larger size those forms use. Append layout
 * modifiers (`self-start`, `disabled:opacity-40`) at the call site. */
export const ADMIN_PRIMARY_BUTTON_CLS =
  'tracked text-[11px] font-semibold px-4 py-2.5 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:brightness-110 transition-all';

/** The small bordered button (row actions, "Close survey", "+ Add question", Join / Leave Season). Append `disabled:opacity-40`
 * at the call site when the action can be busy. */
export const SMALL_BUTTON_CLS =
  'tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors';

/** The unboxed "Cancel" beside a form's Save, for a form that opens in place of a line. */
export const CANCEL_BUTTON_CLS =
  'tracked text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors';

/** `SMALL_BUTTON_CLS` in green — a selected or confirming small button (a scrim signup's
 * "Definite", "Add"). */
export const SMALL_GREEN_BUTTON_CLS =
  'tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:brightness-110 transition-all';

/** `SMALL_BUTTON_CLS` in amber — a selected tentative choice (a scrim signup's "Maybe"). */
export const SMALL_AMBER_BUTTON_CLS =
  'tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-accent-amber-border)] text-[var(--color-accent-amber-fg)] bg-[var(--color-accent-amber-bg)] hover:brightness-110 transition-all';
