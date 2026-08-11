'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useHasMounted } from './useHasMounted';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared full-viewport modal overlay — the fixed backdrop, centering, portal-to-body,
 * backdrop-click-to-dismiss, and dialog semantics (role, focus trap, Escape-to-close) that
 * RegisterModal, DemoUploadModal, and RecordingViewer's clear-confirm each hand-rolled
 * independently. The panel itself (background, border, padding, width) stays the caller's own
 * markup via `children`, since that varies per use; `overlayClassName` covers the one piece of
 * the backdrop itself that varies (color/blur treatment).
 */
export default function Modal({
  onClose,
  overlayClassName = 'bg-black/60 backdrop-blur-sm',
  panelClassName,
  ariaLabel,
  children,
}: {
  /** Called when the backdrop (not the panel) is clicked, or Escape is pressed. Omit for a
   *  non-dismissible overlay — Escape is then a no-op, matching the backdrop-click behavior. */
  onClose?: () => void;
  /** Backdrop classes — color/blur/padding. */
  overlayClassName?: string;
  /** Classes for the centered panel. */
  panelClassName: string;
  /** Accessible name for the dialog, since the heading (if any) inside `children` isn't reliably
   *  reachable as an `aria-labelledby` target from here. */
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  const mounted = useHasMounted();
  const panelRef = useRef<HTMLDivElement>(null);
  // Read through a ref inside the effect below instead of listing `onClose` as a dependency —
  // callers pass a fresh closure every render, and re-running the effect on every render would
  // re-focus the panel and steal focus from whatever the user is doing inside it (e.g. typing).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!mounted) return;
    const panel = panelRef.current;
    if (!panel) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    panel.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      // The trap keeps focus inside the panel by construction, so this only ever fires for
      // Tab presses that originated there — but skip the DOM query if focus somehow left anyway
      // (e.g. a second, unrelated Modal instance's own listener sees this same keydown).
      if (!panel!.contains(document.activeElement)) return;
      const focusable = Array.from(panel!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null,
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
    // `mounted` only ever flips false -> true once for a given Modal instance, so this runs
    // exactly once per open modal, not on every parent re-render.
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${overlayClassName}`}
      onClick={onClose ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={panelClassName}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
