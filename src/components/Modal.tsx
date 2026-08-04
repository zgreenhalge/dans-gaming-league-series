'use client';

import { createPortal } from 'react-dom';
import { useHasMounted } from './useHasMounted';

/**
 * Shared full-viewport modal overlay — the fixed backdrop, centering, portal-to-body,
 * and backdrop-click-to-dismiss wiring that RegisterModal, DemoUploadModal, and
 * RecordingViewer's clear-confirm each hand-rolled independently. The panel itself
 * (background, border, padding, width) stays the caller's own markup via `children`,
 * since that varies per use; `overlayClassName` covers the one piece of the backdrop
 * itself that varies (color/blur treatment).
 */
export default function Modal({
  onClose,
  overlayClassName = 'bg-black/60 backdrop-blur-sm',
  panelClassName,
  children,
}: {
  /** Called when the backdrop (not the panel) is clicked. Omit for a non-dismissible overlay. */
  onClose?: () => void;
  /** Backdrop classes — color/blur/padding. */
  overlayClassName?: string;
  /** Classes for the centered panel. */
  panelClassName: string;
  children: React.ReactNode;
}) {
  const mounted = useHasMounted();
  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${overlayClassName}`}
      onClick={onClose ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
    >
      <div className={panelClassName} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body
  );
}
