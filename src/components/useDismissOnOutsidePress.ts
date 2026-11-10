'use client';

import { useEffect, type RefObject } from 'react';

/** While `open`, a press anywhere outside `ref`'s element calls `setOpen(false)` — for a dropdown or
 *  menu that closes when the user presses elsewhere. Focus stays where the press put it. */
export function useDismissOnOutsidePress(ref: RefObject<HTMLElement | null>, open: boolean, setOpen: (open: boolean) => void) {
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [ref, open, setOpen]);
}
