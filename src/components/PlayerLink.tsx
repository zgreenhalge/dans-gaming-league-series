'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import type { PlayerSummary } from '@/lib/queries';
import { playerHref } from '@/lib/crumbs';
import { PlayerPreviewCard } from './PlayerPreviewCard';

// A link to a player's page that previews them on hover, keyboard focus and touch long-press: a
// `PlayerPreviewCard` opens beside the link — a skeleton card until
// `GET /api/players/[id]/summary` answers, fetched on open and reused for a minute.
// - Mouse: opens on enter; stays open while the pointer is over the link or the card.
// - Keyboard: opens when the link takes keyboard focus (`:focus-visible`), closes on blur or
//   Escape. The card is `role="tooltip"` and the link points at it with `aria-describedby`.
// - Touch / pen: a tap navigates as a plain link does; holding for `LONG_PRESS_MS` opens the card
//   instead (the click that follows the release is swallowed). A press anywhere else closes it.
// The card renders in a portal (`document.body`), so a table's `overflow` container can't clip it.
// It is placed from its measured size and follows its link through scroll and resize; it closes
// only when the link leaves the viewport.

const CLOSE_DELAY_MS = 120;
const LONG_PRESS_MS = 500;
/** A touch that drifts further than this from where it landed is a scroll or swipe, not a press. */
const LONG_PRESS_SLOP_PX = 10;
/** The card's minimum distance from the viewport edge. The gap between link and card is padding
 *  inside the card's wrapper (`py-1.5`), so the pointer never leaves hoverable ground crossing it. */
const EDGE_PX = 8;

/** How long a loaded summary is reused — the summary route's `s-maxage`. A tab left open through
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

type Position = { top: number; left: number };

/** Where the card's wrapper (`width` x `height`, measured) goes for a link at `rect`: below it, or
 *  above when the viewport has more room there, left-aligned to the link and kept inside the
 *  viewport. */
export function placeCard(rect: DOMRect, width: number, height: number): Position {
  const left = Math.max(EDGE_PX, Math.min(rect.left, window.innerWidth - width - EDGE_PX));
  const roomBelow = window.innerHeight - rect.bottom;
  const above = roomBelow < height && rect.top > roomBelow;
  const top = above ? rect.top - height : rect.bottom;
  return { top: Math.max(EDGE_PX, top), left };
}

function isOffscreen(rect: DOMRect): boolean {
  return rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth;
}

/** Whether a focus event came from the keyboard, so a mouse click's focus doesn't open the card. */
function isKeyboardFocus(el: HTMLElement): boolean {
  try { return el.matches(':focus-visible'); } catch { return true; }
}

export function PlayerLink({
  playerId,
  ...linkProps
}: { playerId: number } & Omit<React.ComponentProps<typeof Link>, 'href'>) {
  const {
    onPointerEnter, onPointerLeave, onPointerDown, onPointerUp, onPointerCancel, onPointerMove,
    onClick, onContextMenu, onFocus, onBlur, 'aria-describedby': describedBy, ...rest
  } = linkProps;
  const ref = useRef<HTMLAnchorElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const cardId = useId();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  /** Set when a long-press opened the card, so the click that ends the press doesn't navigate. */
  const longPressed = useRef(false);
  /** `summary` is `null` while it loads; `pos` is `null` until the card has been measured. */
  const [open, setOpen] = useState<{ summary: PlayerSummary | null; pos: Position | null } | null>(null);

  const cancelClose = () => clearTimeout(closeTimer.current);
  const cancelPress = () => { clearTimeout(pressTimer.current); pressStart.current = null; };
  const close = () => { cancelClose(); setOpen(null); };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(null), CLOSE_DELAY_MS);
  };
  useEffect(() => () => { cancelClose(); cancelPress(); }, []);

  /** Measure the card and place it against its link; close if the link has left the viewport. */
  const place = () => {
    const link = ref.current;
    const card = cardRef.current;
    if (!link || !card) return;
    const rect = link.getBoundingClientRect();
    if (isOffscreen(rect)) { setOpen(null); return; }
    const pos = placeCard(rect, card.offsetWidth, card.offsetHeight);
    setOpen((o) => (o && (o.pos?.top !== pos.top || o.pos?.left !== pos.left) ? { ...o, pos } : o));
  };

  // The skeleton and the loaded card differ in height, so re-measure when the summary arrives.
  const isOpen = open !== null;
  const hasSummary = open?.summary != null;
  useLayoutEffect(() => {
    if (isOpen) place();
  }, [isOpen, hasSummary]);

  // While open: follow the link through scroll and resize, and close on Escape or a press elsewhere.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    const onPress = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !cardRef.current?.contains(target)) setOpen(null);
    };
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [isOpen]);

  const show = () => {
    setOpen((o) => o ?? { summary: null, pos: null });
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
        href={playerHref(playerId)}
        aria-describedby={[describedBy, open ? cardId : undefined].filter(Boolean).join(' ') || undefined}
        style={{ WebkitTouchCallout: 'none', ...rest.style }}
        onPointerEnter={(e) => {
          onPointerEnter?.(e);
          if (e.pointerType !== 'mouse') return;
          cancelClose();
          show();
        }}
        onPointerLeave={(e) => {
          onPointerLeave?.(e);
          if (e.pointerType === 'mouse') scheduleClose();
        }}
        onPointerDown={(e) => {
          onPointerDown?.(e);
          if (e.pointerType === 'mouse') return;
          longPressed.current = false;
          cancelPress();
          pressStart.current = { x: e.clientX, y: e.clientY };
          pressTimer.current = setTimeout(() => {
            pressStart.current = null;
            longPressed.current = true;
            show();
          }, LONG_PRESS_MS);
        }}
        onPointerMove={(e) => {
          onPointerMove?.(e);
          const start = pressStart.current;
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_SLOP_PX) cancelPress();
        }}
        onPointerUp={(e) => { onPointerUp?.(e); cancelPress(); }}
        onPointerCancel={(e) => { onPointerCancel?.(e); cancelPress(); }}
        onContextMenu={(e) => {
          onContextMenu?.(e);
          // A touch long-press would otherwise open the browser's link menu over the card.
          if (pressStart.current || longPressed.current) e.preventDefault();
        }}
        onClick={(e) => {
          onClick?.(e);
          if (longPressed.current) {
            longPressed.current = false;
            e.preventDefault();
          }
        }}
        onFocus={(e) => {
          onFocus?.(e);
          if (!isKeyboardFocus(e.currentTarget)) return;
          cancelClose();
          show();
        }}
        onBlur={(e) => {
          onBlur?.(e);
          close();
        }}
      />
      {open && createPortal(
        <div
          ref={cardRef}
          id={cardId}
          role="tooltip"
          className="fixed z-50 py-1.5"
          style={{ ...open.pos, visibility: open.pos ? 'visible' : 'hidden' }}
          onPointerEnter={(e) => { if (e.pointerType === 'mouse') cancelClose(); }}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') scheduleClose(); }}
        >
          <PlayerPreviewCard summary={open.summary} />
        </div>,
        document.body,
      )}
    </>
  );
}
