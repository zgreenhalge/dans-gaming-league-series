// @vitest-environment jsdom
/**
 * Component tests for `PlayerLink.tsx` and the `PlayerPreviewCard` it opens: a mouse hover opens
 * the card at once as a skeleton, fills it from the player's summary, keeps it open while the
 * mouse is over the link or the card, a touch or pen pointer never opens it, and the link itself
 * still goes to the player's page.
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

/** Hover with `pointerType`, then let the fetch settle. */
async function hover(link: HTMLElement, pointerType = 'mouse') {
  fireEvent.pointerEnter(link, { pointerType });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

/** Let the close delay run out. */
const settleClose = () => act(async () => { await vi.advanceTimersByTimeAsync(300); });

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

  test('the card opens at once as a skeleton, then fills in when the summary arrives', async () => {
    let resolve!: (v: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<PlayerLink playerId={103}>Rook</PlayerLink>);
    fireEvent.pointerEnter(screen.getByRole('link', { name: 'Rook' }), { pointerType: 'mouse' });
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText('31-19')).toBeNull();
    await act(async () => { resolve({ ok: true, json: async () => summary(103) }); await vi.advanceTimersByTimeAsync(0); });
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByText('31-19')).toBeInTheDocument();
  });

  test('leaving the link closes the card', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => summary(104) });
    render(<PlayerLink playerId={104}>Rook</PlayerLink>);
    const link = screen.getByRole('link', { name: 'Rook' });
    await hover(link);
    fireEvent.pointerLeave(link);
    await settleClose();
    expect(screen.queryByText('Form')).toBeNull();
  });

  test('the card stays open while the mouse is over it, and closes when it leaves the card', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => summary(105) });
    render(<PlayerLink playerId={105}>Rook</PlayerLink>);
    const link = screen.getByRole('link', { name: 'Rook' });
    await hover(link);
    const card = screen.getByText('Form').closest('.fixed') as HTMLElement;
    fireEvent.pointerLeave(link);
    fireEvent.pointerEnter(card);
    await settleClose();
    expect(screen.getByText('Form')).toBeInTheDocument();
    fireEvent.pointerLeave(card);
    await settleClose();
    expect(screen.queryByText('Form')).toBeNull();
  });

  test('a touch pointer never fetches or opens the card', async () => {
    render(<PlayerLink playerId={106}>Rook</PlayerLink>);
    await hover(screen.getByRole('link', { name: 'Rook' }), 'touch');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  test('a summary that finishes loading after the pointer left does not reopen the card', async () => {
    let resolve!: (v: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<PlayerLink playerId={107}>Rook</PlayerLink>);
    const link = screen.getByRole('link', { name: 'Rook' });
    await hover(link);
    fireEvent.pointerLeave(link);
    await settleClose();
    await act(async () => { resolve({ ok: true, json: async () => summary(107) }); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByText('Form')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  test('a failed load closes the card instead of leaving the skeleton up, and is retried on the next hover', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true, json: async () => summary(108) });
    render(<PlayerLink playerId={108}>Rook</PlayerLink>);
    const link = screen.getByRole('link', { name: 'Rook' });
    await hover(link);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByText('Form')).toBeNull();
    fireEvent.pointerLeave(link);
    await hover(link);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Form')).toBeInTheDocument();
  });
});
