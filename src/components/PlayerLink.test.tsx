// @vitest-environment jsdom
/**
 * Component tests for `PlayerLink.tsx` and the `PlayerPreviewCard` it opens: a mouse hover opens
 * the card at once as a skeleton, fills it from the player's summary, keeps it open while the
 * mouse is over the link or the card, keyboard focus opens it (closed by blur or Escape), a scroll
 * moves it rather than closing it, a touch long-press opens it while a tap still navigates, and the
 * link itself goes to the player's page.
 *
 * Run:  npx vitest run src/components/PlayerLink.test.tsx
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PlayerLink, placeCard } from './PlayerLink';
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
    fireEvent.pointerLeave(link, { pointerType: 'mouse' });
    await settleClose();
    expect(screen.queryByText('Form')).toBeNull();
  });

  test('the card stays open while the mouse is over it, and closes when it leaves the card', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => summary(105) });
    render(<PlayerLink playerId={105}>Rook</PlayerLink>);
    const link = screen.getByRole('link', { name: 'Rook' });
    await hover(link);
    const card = screen.getByText('Form').closest('.fixed') as HTMLElement;
    fireEvent.pointerLeave(link, { pointerType: 'mouse' });
    fireEvent.pointerEnter(card, { pointerType: 'mouse' });
    await settleClose();
    expect(screen.getByText('Form')).toBeInTheDocument();
    fireEvent.pointerLeave(card, { pointerType: 'mouse' });
    await settleClose();
    expect(screen.queryByText('Form')).toBeNull();
  });

  test('a summary that finishes loading after the pointer left does not reopen the card', async () => {
    let resolve!: (v: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<PlayerLink playerId={107}>Rook</PlayerLink>);
    const link = screen.getByRole('link', { name: 'Rook' });
    await hover(link);
    fireEvent.pointerLeave(link, { pointerType: 'mouse' });
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
    fireEvent.pointerLeave(link, { pointerType: 'mouse' });
    await hover(link);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Form')).toBeInTheDocument();
  });

  test('a touch hover (no long-press) never fetches or opens the card', async () => {
    render(<PlayerLink playerId={106}>Rook</PlayerLink>);
    await hover(screen.getByRole('link', { name: 'Rook' }), 'touch');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });
});

describe('PlayerLink keyboard', () => {
  test('keyboard focus opens the card, described by the link; blur closes it', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => summary(110) });
    render(<PlayerLink playerId={110}>Rook</PlayerLink>);
    const link = screen.getByRole('link', { name: 'Rook' });
    // jsdom has no :focus-visible; stand in for a keyboard-driven focus.
    vi.spyOn(link, 'matches').mockReturnValue(true);
    await act(async () => { fireEvent.focus(link); await vi.advanceTimersByTimeAsync(0); });
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('31-19');
    expect(link.getAttribute('aria-describedby')).toBe(tip.id);
    fireEvent.blur(link);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(link).not.toHaveAttribute('aria-describedby');
  });

  test('the mouse leaving does not close a card that keyboard focus holds open', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => summary(117) });
    render(<PlayerLink playerId={117}>Rook</PlayerLink>);
    const link = screen.getByRole('link', { name: 'Rook' });
    vi.spyOn(link, 'matches').mockReturnValue(true);
    await act(async () => { link.focus(); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.pointerLeave(link, { pointerType: 'mouse' });
    await settleClose();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  test('Escape closes an open card', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => summary(111) });
    render(<PlayerLink playerId={111}>Rook</PlayerLink>);
    await hover(screen.getByRole('link', { name: 'Rook' }));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('PlayerLink scroll', () => {
  const rectAt = (top: number) => ({ top, bottom: top + 20, left: 50, right: 120, width: 70, height: 20, x: 50, y: top, toJSON() {} }) as DOMRect;

  test('a scroll repositions the card; it closes only when the link leaves the viewport', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => summary(112) });
    render(<PlayerLink playerId={112}>Rook</PlayerLink>);
    const link = screen.getByRole('link', { name: 'Rook' });
    const rect = vi.spyOn(link, 'getBoundingClientRect').mockReturnValue(rectAt(100));
    await hover(link);
    const tip = screen.getByRole('tooltip');
    expect(tip.style.top).toBe('120px');
    rect.mockReturnValue(rectAt(60));
    fireEvent.scroll(window);
    expect(screen.getByRole('tooltip').style.top).toBe('80px');
    rect.mockReturnValue(rectAt(-200));
    fireEvent.scroll(window);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('PlayerLink touch long-press', () => {
  test('holding opens the card and the click that follows does not navigate', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => summary(113) });
    render(<PlayerLink playerId={113}>Rook</PlayerLink>);
    const link = screen.getByRole('link', { name: 'Rook' });
    fireEvent.pointerDown(link, { pointerType: 'touch', clientX: 5, clientY: 5 });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(screen.getByRole('tooltip')).toHaveTextContent('31-19');
    fireEvent.pointerUp(link, { pointerType: 'touch' });
    fireEvent.pointerLeave(link, { pointerType: 'touch' });
    await settleClose();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(fireEvent.click(link, { detail: 1 })).toBe(false);
  });

  test('a keyboard activation after an abandoned long-press still navigates', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => summary(116) });
    render(<PlayerLink playerId={116}>Rook</PlayerLink>);
    const link = screen.getByRole('link', { name: 'Rook' });
    fireEvent.pointerDown(link, { pointerType: 'touch', clientX: 5, clientY: 5 });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    fireEvent.pointerCancel(link, { pointerType: 'touch' });
    expect(fireEvent.click(link, { detail: 0 })).toBe(true);
  });

  test('a quick tap does not open the card and still navigates', async () => {
    render(<PlayerLink playerId={114}>Rook</PlayerLink>);
    const link = screen.getByRole('link', { name: 'Rook' });
    fireEvent.pointerDown(link, { pointerType: 'touch', clientX: 5, clientY: 5 });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    fireEvent.pointerUp(link, { pointerType: 'touch' });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fireEvent.click(link)).toBe(true);
  });

  test('dragging away cancels the long-press', async () => {
    render(<PlayerLink playerId={115}>Rook</PlayerLink>);
    const link = screen.getByRole('link', { name: 'Rook' });
    fireEvent.pointerDown(link, { pointerType: 'touch', clientX: 5, clientY: 5 });
    fireEvent.pointerMove(link, { pointerType: 'touch', clientX: 5, clientY: 60 });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  test('a press elsewhere closes the card', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => summary(116) });
    render(<PlayerLink playerId={116}>Rook</PlayerLink>);
    const link = screen.getByRole('link', { name: 'Rook' });
    fireEvent.pointerDown(link, { pointerType: 'touch', clientX: 5, clientY: 5 });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    fireEvent.pointerDown(document.body, { pointerType: 'touch' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('placeCard', () => {
  const rect = (top: number, left = 50) => ({ top, bottom: top + 20, left, right: left + 70 }) as DOMRect;
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
  });

  test('goes below the link when it fits', () => {
    expect(placeCard(rect(100), 320, 200)).toEqual({ top: 120, left: 50 });
  });
  test('flips above when below is short and above has more room', () => {
    expect(placeCard(rect(500), 320, 200)).toEqual({ top: 300, left: 50 });
  });
  test('stays below when neither side fits and below has more room', () => {
    expect(placeCard(rect(100), 320, 560)).toEqual({ top: 120, left: 50 });
  });
  test('keeps the card inside the viewport horizontally', () => {
    expect(placeCard(rect(100, 300), 320, 200).left).toBe(72);
  });
});
