// Shared admin button class strings. A plain module (no 'use client') so both server and client
// components can import the strings.

/** The primary admin submit button (form CTAs like "Create Season" or "Confirm & Build") — shares
 * `CONFIRM_VARIANT.primary`'s green scheme at the larger size those forms use. Append layout
 * modifiers (`self-start`, `disabled:opacity-40`) at the call site. */
export const ADMIN_PRIMARY_BUTTON_CLS =
  'tracked text-[11px] font-semibold px-4 py-2.5 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:brightness-110 transition-all';

/** The small bordered admin button (row actions, "Close survey", "+ Add question"). Append `disabled:opacity-40`
 * at the call site when the action can be busy. */
export const ADMIN_SMALL_BUTTON_CLS =
  'tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors';
