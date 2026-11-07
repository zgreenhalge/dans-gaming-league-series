// @vitest-environment jsdom
/**
 * Component tests for `ScrimNightStats`: it fetches the night's stat data when it mounts, shows a
 * skeleton meanwhile, and offers Retry when the fetch fails.
 * Run: npx vitest run src/components/ScrimNightStats.test.tsx
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScrimNightStats } from './ScrimNightStats';
import { UrlStateProvider } from './UrlStateProvider';

vi.mock('./useRealtimeChanges', () => ({ useRealtimeChanges: () => {} }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/scrims/6',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: () => {}, push: () => {} }),
}));

const EMPTY_VIEW = { matches: [], rounds: [], sabremetrics: [], kills: [], weaponClassStats: [], economyStats: [] };

describe('ScrimNightStats', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('a failed fetch shows Retry, which fetches again', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(EMPTY_VIEW)));
    vi.stubGlobal('fetch', fetchMock);
    render(<UrlStateProvider><ScrimNightStats nightId={6} view="stats" rows={[]} /></UrlStateProvider>);
    await userEvent.click(await screen.findByRole('button', { name: /retry/i }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/scrims/6/stats');
    expect(await screen.findByRole('tab', { name: 'Basic Stats' })).toBeInTheDocument();
  });
});
