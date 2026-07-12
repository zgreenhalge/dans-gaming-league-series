// Barrel — re-exports every domain module so `@/lib/queries` keeps resolving unchanged for all
// existing callers. `_shared.ts` (fetchAllPages, SUPABASE_PAGE_SIZE) is intentionally not
// re-exported here — it's private plumbing used only by the domain files themselves.
export * from './seasons';
export * from './schedule';
export * from './match';
export * from './admin';
export * from './player';
export * from './leaderboard';
export * from './gauntlet';
export * from './trophies';
export * from './maps';
export * from './h2h';
export * from './ehog';
export * from './sabremetrics';
export * from './replay';
export * from './ops';
