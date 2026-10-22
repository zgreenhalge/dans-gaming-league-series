'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import type { PlayerSummary } from '@/lib/queries';
import { PlayerPreviewCard } from './PlayerPreviewCard';

// A link to a player's page that previews them on hover: a `PlayerPreviewCard` opens beside the
// link after a short delay, fetched from `GET /api/players/[id]/summary` on first hover and kept
// for the rest of the page's life. The card renders in a portal (`document.body`), so a table's
// `overflow` container can't clip it. It's mouse-only — touch and pen taps navigate, as a plain
// link does — and it ignores the pointer, so it never blocks the link itself.

const OPEN_DELAY_MS = 300;
const CLOSE_DELAY_MS = 80;
/** Gap between the link and the card, and the card's minimum distance from the viewport edge. */
const GAP_PX = 6;
const EDGE_PX = 8;
/** The card's width (`PlayerPreviewCard`'s `w-[20rem]`) and the space it needs below its link
 *  before it flips above (its rendered height is ~200px). */
const CARD_WIDTH_PX = 320;
const CARD_HEIGHT_PX = 210;

/** Summaries by player id, shared by every `PlayerLink` on the page. */
const summaries = new Map<number, Promise<PlayerSummary | null>>();

function loadSummary(playerId: number): Promise<PlayerSummary | null> {
  let pending = summaries.get(playerId);
  if (!pending) {
    pending = fetch(`/api/players/${playerId}/summary`)
      .then((res) => (res.ok ? (res.json() as Promise<PlayerSummary>) : null))
      .catch(() => null);
    // A failed load is retried on the next hover rather than cached.
    pending.then((s) => { if (!s) summaries.delete(playerId); });
    summaries.set(playerId, pending);
  }
  return pending;
}

/** Fixed-position style placing a card of `width` below `rect` (above when the viewport has no room
 *  below), left-aligned to it and kept inside the viewport. */
function cardPosition(rect: DOMRect, width: number): React.CSSProperties {
  const left = Math.max(EDGE_PX, Math.min(rect.left, window.innerWidth - width - EDGE_PX));
  const fitsBelow = rect.bottom + GAP_PX + CARD_HEIGHT_PX <= window.innerHeight;
  return fitsBelow
    ? { top: rect.bottom + GAP_PX, left }
    : { bottom: window.innerHeight - rect.top + GAP_PX, left };
}

export function PlayerLink({
  playerId,
  ...linkProps
}: { playerId: number } & Omit<React.ComponentProps<typeof Link>, 'href'>) {
  const { onPointerEnter, onPointerLeave, ...rest } = linkProps;
  const ref = useRef<HTMLAnchorElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Whether the pointer is still on the link — a slow summary load must not open the card after it left. */
  const hovering = useRef(false);
  const [open, setOpen] = useState<{ summary: PlayerSummary; style: React.CSSProperties } | null>(null);

  const clearTimer = () => clearTimeout(timer.current);
  useEffect(() => clearTimer, []);

  // The card is positioned from the link's rect at open time, so a scroll or resize closes it.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const show = useCallback(() => {
    loadSummary(playerId).then((summary) => {
      const el = ref.current;
      if (!summary || !el || !hovering.current) return;
      setOpen({ summary, style: cardPosition(el.getBoundingClientRect(), CARD_WIDTH_PX) });
    });
  }, [playerId]);

  return (
    <>
      <Link
        {...rest}
        ref={ref}
        href={`/players/${playerId}`}
        onPointerEnter={(e) => {
          onPointerEnter?.(e);
          if (e.pointerType !== 'mouse') return;
          hovering.current = true;
          clearTimer();
          timer.current = setTimeout(show, OPEN_DELAY_MS);
        }}
        onPointerLeave={(e) => {
          onPointerLeave?.(e);
          hovering.current = false;
          clearTimer();
          timer.current = setTimeout(() => setOpen(null), CLOSE_DELAY_MS);
        }}
      />
      {open && createPortal(
        <div className="pointer-events-none fixed z-50" style={open.style}>
          <PlayerPreviewCard summary={open.summary} />
        </div>,
        document.body,
      )}
    </>
  );
}
