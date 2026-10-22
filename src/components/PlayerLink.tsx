'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import type { PlayerSummary } from '@/lib/queries';
import { PLAYER_PREVIEW_CARD_WIDTH_REM, PlayerPreviewCard } from './PlayerPreviewCard';

// A link to a player's page that previews them on hover: a `PlayerPreviewCard` opens beside the
// link as soon as the mouse is on it — a skeleton card until `GET /api/players/[id]/summary`
// answers, fetched on hover and reused for a minute. The card stays open
// while the mouse is over the link or the card itself. It renders in a portal (`document.body`), so
// a table's `overflow` container can't clip it. It's mouse-only — touch and pen taps navigate, as a
// plain link does.

const CLOSE_DELAY_MS = 120;
/** Gap between the link and the card, and the card's minimum distance from the viewport edge. The
 *  gap is padding inside the card's wrapper (`py-1.5`), so the pointer never leaves hoverable ground
 *  crossing it. */
const GAP_PX = 6;
const EDGE_PX = 8;
/** The card's width and the space it needs below its link before it flips above (its rendered
 *  height is ~200px). */
const CARD_WIDTH_PX = PLAYER_PREVIEW_CARD_WIDTH_REM * 16;
const CARD_HEIGHT_PX = 210;

/** How long a loaded summary is reused — the summary route's own `max-age`. A tab left open through
 *  a match night re-fetches rather than previewing stale figures. */
const SUMMARY_TTL_MS = 60_000;

/** Summaries by player id, shared by every `PlayerLink` on the page. */
const summaries = new Map<number, { at: number; pending: Promise<PlayerSummary | null> }>();

function loadSummary(playerId: number): Promise<PlayerSummary | null> {
  const cached = summaries.get(playerId);
  if (cached && Date.now() - cached.at < SUMMARY_TTL_MS) return cached.pending;
  const pending = fetch(`/api/players/${playerId}/summary`)
    .then((res) => (res.ok ? (res.json() as Promise<PlayerSummary>) : null))
    .catch(() => null);
  // A failed load is retried on the next hover rather than cached.
  pending.then((s) => { if (!s) summaries.delete(playerId); });
  summaries.set(playerId, { at: Date.now(), pending });
  return pending;
}

/** Fixed-position style for the card's wrapper: below `rect` (above when the viewport has no room
 *  below), left-aligned to it and kept inside the viewport. */
function cardPlacement(rect: DOMRect): React.CSSProperties {
  const left = Math.max(EDGE_PX, Math.min(rect.left, window.innerWidth - CARD_WIDTH_PX - EDGE_PX));
  const above = rect.bottom + GAP_PX + CARD_HEIGHT_PX > window.innerHeight;
  return above ? { bottom: window.innerHeight - rect.top, left } : { top: rect.bottom, left };
}

export function PlayerLink({
  playerId,
  ...linkProps
}: { playerId: number } & Omit<React.ComponentProps<typeof Link>, 'href'>) {
  const { onPointerEnter, onPointerLeave, ...rest } = linkProps;
  const ref = useRef<HTMLAnchorElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** `summary` is `null` while it loads. */
  const [open, setOpen] = useState<{ summary: PlayerSummary | null; style: React.CSSProperties } | null>(null);

  const cancelClose = () => clearTimeout(closeTimer.current);
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(null), CLOSE_DELAY_MS);
  };
  useEffect(() => cancelClose, []);

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

  const show = () => {
    const el = ref.current;
    if (!el) return;
    setOpen((o) => o ?? { summary: null, style: cardPlacement(el.getBoundingClientRect()) });
    loadSummary(playerId).then((summary) => {
      // Closed while loading: nothing to fill. Failed: no card rather than a stuck skeleton.
      setOpen((o) => (o && summary ? { ...o, summary } : null));
    });
  };

  return (
    <>
      <Link
        {...rest}
        ref={ref}
        href={`/players/${playerId}`}
        onPointerEnter={(e) => {
          onPointerEnter?.(e);
          if (e.pointerType !== 'mouse') return;
          cancelClose();
          show();
        }}
        onPointerLeave={(e) => {
          onPointerLeave?.(e);
          scheduleClose();
        }}
      />
      {open && createPortal(
        <div
          className="fixed z-50 py-1.5"
          style={open.style}
          onPointerEnter={cancelClose}
          onPointerLeave={scheduleClose}
        >
          <PlayerPreviewCard summary={open.summary} />
        </div>,
        document.body,
      )}
    </>
  );
}
