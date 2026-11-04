// @vitest-environment jsdom
/**
 * Component tests for `MatchScoreHero`'s live score over Realtime: a `live_match_score` DELETE clears
 * the score only for this hero's own match, even if one for another match reaches its subscription;
 * and the mount's live-score read never wipes a score Realtime delivered while it was in flight.
 * Run: npx vitest run src/components/MatchScoreHero.test.tsx
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import MatchScoreHero from './MatchScoreHero';

type Handler = (payload: { eventType: string; new: unknown; old: unknown }) => void;
const realtime = vi.hoisted(() => ({ handler: null as Handler | null }));
vi.mock('./useRealtimeChanges', () => ({
  useRealtimeChanges: (_name: string, _filter: unknown, handler: Handler) => {
    realtime.handler = handler;
  },
}));

const MATCH_ID = 7;

async function renderLive() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ liveScore: null }))));
  render(<MatchScoreHero matchId={MATCH_ID} played={false} vetoComplete finalScore={null} shirtsF={null} skinsF={null} />);
  await act(async () => {
    realtime.handler!({
      eventType: 'UPDATE',
      new: { match_id: MATCH_ID, shirts_score: 5, skins_score: 3, round: 9, updated_at: '2026-11-04T20:00:00Z' },
      old: {},
    });
  });
}

describe('MatchScoreHero live score', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('a DELETE for another match leaves this match\'s live score up', async () => {
    await renderLive();
    expect(screen.getByText('5')).toBeInTheDocument();
    await act(async () => {
      realtime.handler!({ eventType: 'DELETE', new: {}, old: { match_id: MATCH_ID + 1 } });
    });
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  test('an empty mount read that answers after a Realtime update leaves the update showing', async () => {
    let answer: (r: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; })));
    render(<MatchScoreHero matchId={MATCH_ID} played={false} vetoComplete finalScore={null} shirtsF={null} skinsF={null} />);
    await act(async () => {
      realtime.handler!({
        eventType: 'INSERT',
        new: { match_id: MATCH_ID, shirts_score: 5, skins_score: 3, round: 9, updated_at: '2026-11-04T20:00:00Z' },
        old: {},
      });
    });
    await act(async () => {
      answer(new Response(JSON.stringify({ liveScore: null })));
    });
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  test('a DELETE without match_id still clears this match\'s score', async () => {
    await renderLive();
    expect(screen.getByText('5')).toBeInTheDocument();
    await act(async () => {
      realtime.handler!({ eventType: 'DELETE', new: {}, old: {} });
    });
    expect(screen.queryByText('5')).toBeNull();
  });

  test('a DELETE for this match clears the live score', async () => {
    await renderLive();
    expect(screen.getByText('5')).toBeInTheDocument();
    await act(async () => {
      realtime.handler!({ eventType: 'DELETE', new: {}, old: { match_id: MATCH_ID } });
    });
    expect(screen.queryByText('5')).toBeNull();
  });
});
