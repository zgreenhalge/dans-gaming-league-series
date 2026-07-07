/**
 * Shared tuning constants for stat collectors. Anything here is used by more than one
 * collector (or will be once a planned collector lands) — keep collector-local constants
 * (e.g. utility.ts's flash-assist window) in their own file.
 */

// Seconds after a death within which a teammate's revenge kill on the killer counts as a
// trade. Drives kast.ts's "Traded" KAST qualifier and will drive the trade-kill/traded-death
// collector's opportunity/attempt/success counts.
export const TRADE_WINDOW_SECONDS = 5;
