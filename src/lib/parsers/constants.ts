/**
 * Shared tuning constants for stat collectors. Anything here is used by more than one
 * collector — keep collector-local constants (e.g. utility.ts's flash-assist window) in their
 * own file.
 */

// Seconds after a death within which a teammate's revenge kill on the killer counts as a
// trade. Drives kast.ts's "Traded" KAST qualifier and trades.ts's opportunity/attempt/success
// counts, so the two can never disagree.
export const TRADE_WINDOW_SECONDS = 5;
