// @vitest-environment jsdom
/**
 * Component tests for `PlayerLink.tsx` and the `PlayerPreviewCard` it opens: a mouse hover fetches
 * the player's summary and shows the card after a delay, a touch or pen pointer never does, leaving
 * before the load finishes shows nothing, and the link itself still goes to the player's page.
 *
 * Run:  npx vitest run src/components/PlayerLink.test.tsx
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PlayerLink } from './PlayerLink';
import type { PlayerSummary } from '@/lib/queries';

function summary(playerId: number): PlayerSummary {
  return {
    playerId,
    playerName: 'Rook',
    avatarUrl: null,
    ehog: 23.46,
    record: { wins: 31, losses: 19 },
    kda: 1.4286,
    kd: 1.1,
    adr: 74.051,
    recent: [
      { matchId: 18, won: true, score: '13-6', opponents: 'Juno & Tango', map: null },
      { matchId: 16, won: false, score: '8-13', opponents: 'Mav & Pixel', map: null },
    ],
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Hover with `pointerType`, wait out the open delay and let the fetch settle. */
async function hover(link: HTMLElement, pointerType = 'mouse') {
  fireEvent.pointerEnter(link, { pointerType });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
}

describe('PlayerLink', () => {
  test('links to the player page', () => {
    render(<PlayerLink playerId={101}>Rook</PlayerLink>);
    expect(screen.getByRole('link', { name: 'Rook' })).toHaveAttribute('href', '/players/101');
  });

  test('a mouse hover fetches the summary and opens the card with EHOG, record, KDA, ADR and Form', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => summary(102) });
    render(<PlayerLink playerId={102}>Rook</PlayerLink>);
    await hover(screen.getByRole('link', { name: 'Rook' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/players/102/summary');
    expect(screen.getByTitle('EHOG Rating: 23.46')).toBeInTheDocument();
    expect(screen.getByText('31-19')).toBeInTheDocument();
    expect(screen.getByText('1.43')).toBeInTheDocument();
    expect(screen.getByText('74.05')).toBeInTheDocument();
    expect(screen.getByText('Form')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^(Win|Loss)$/)).toHaveLength(2);
  });

  test('leaving closes the card', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => summary(103) });
    render(<PlayerLink playerId={103}>Rook</PlayerLink>);
    const link = screen.getByRole('link', { name: 'Rook' });
    await hover(link);
    expect(screen.getByText('Form')).toBeInTheDocument();
    fireEvent.pointerLeave(link);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.queryByText('Form')).toBeNull();
  });

  test('a touch pointer never fetches or opens the card', async () => {
    render(<PlayerLink playerId={104}>Rook</PlayerLink>);
    await hover(screen.getByRole('link', { name: 'Rook' }), 'touch');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('leaving before the open delay fetches nothing', async () => {
    render(<PlayerLink playerId={105}>Rook</PlayerLink>);
    const link = screen.getByRole('link', { name: 'Rook' });
    fireEvent.pointerEnter(link, { pointerType: 'mouse' });
    fireEvent.pointerLeave(link);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a summary that finishes loading after the pointer left does not open the card', async () => {
    let resolve!: (v: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<PlayerLink playerId={106}>Rook</PlayerLink>);
    const link = screen.getByRole('link', { name: 'Rook' });
    await hover(link);
    fireEvent.pointerLeave(link);
    await act(async () => { resolve({ ok: true, json: async () => summary(106) }); await vi.advanceTimersByTimeAsync(200); });
    expect(screen.queryByText('Form')).toBeNull();
  });

  test('a failed load shows no card and is retried on the next hover', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true, json: async () => summary(107) });
    render(<PlayerLink playerId={107}>Rook</PlayerLink>);
    const link = screen.getByRole('link', { name: 'Rook' });
    await hover(link);
    expect(screen.queryByText('Form')).toBeNull();
    fireEvent.pointerLeave(link);
    await hover(link);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Form')).toBeInTheDocument();
  });
});
