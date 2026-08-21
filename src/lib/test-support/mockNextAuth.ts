/**
 * Shared `next-auth/react` mock for component tests that render something using `useSession()`
 * (e.g. `LeaderboardTable`, `GauntletStandings`) without testing auth-dependent behavior themselves.
 * A test file still has to call `vi.mock('next-auth/react', () => createNextAuthMock())` itself —
 * `vi.mock` is hoisted per-file and can't be triggered from an imported helper.
 */
export function createNextAuthMock() {
  return { useSession: () => ({ data: null }) };
}
