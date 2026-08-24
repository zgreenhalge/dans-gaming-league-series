'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Preloads and caches CS2 icon SVGs as tinted, `ctx.drawImage()`-ready `HTMLImageElement`s, for
 * the 2D Replay canvas's kill feed and bomb marker. `draw.ts` runs inside a `requestAnimationFrame`
 * loop calling raw `CanvasRenderingContext2D` methods — it can't reference a static file URL the
 * way a DOM icon component does, and even if it could, a plain `<img>`/`fetch`'d SVG has no CSS
 * context for `currentColor` to resolve against, so every icon in `public/{weapon,grenade,
 * round}-icons/` would render solid black. This bakes the desired color directly into the SVG text
 * (a simple string replace — every icon in this codebase uses `currentColor` as its only fill) and
 * loads the result as a data-URI image, once per (src, color) pair, cached for reuse.
 *
 * `get()` returns `null` immediately for a pair that hasn't finished loading (or hasn't been
 * requested before) rather than blocking the draw call — callers fall back to their existing
 * shape/text rendering for that frame. `generation` increments each time a new sprite finishes
 * loading; a caller drives a repaint off it directly (e.g. `useEffect(() => draw(), [generation,
 * draw])`) so a *paused* frame — whose RAF loop only calls `draw()` once, not every frame — still
 * picks up the icon once it's ready instead of showing the fallback forever.
 */
export function useIconSprites(): {
  get: (src: string, color: string) => HTMLImageElement | null;
  generation: number;
} {
  const rawText = useRef(new Map<string, string>());
  const rawPending = useRef(new Set<string>());
  const images = useRef(new Map<string, HTMLImageElement>());
  const imagePending = useRef(new Set<string>());
  const [generation, setGeneration] = useState(0);

  const get = useCallback((src: string, color: string): HTMLImageElement | null => {
    const key = `${src}::${color}`;
    const cached = images.current.get(key);
    if (cached) return cached;

    const text = rawText.current.get(src);
    if (text === undefined) {
      if (!rawPending.current.has(src)) {
        rawPending.current.add(src);
        fetch(src)
          .then((res) => res.text())
          .then((t) => {
            rawText.current.set(src, t);
            rawPending.current.delete(src);
            setGeneration((g) => g + 1);
          })
          .catch(() => {
            rawPending.current.delete(src);
          });
      }
      return null;
    }

    if (!imagePending.current.has(key)) {
      imagePending.current.add(key);
      const tinted = text.replaceAll('currentColor', color);
      const img = new Image();
      img.onload = () => {
        images.current.set(key, img);
        imagePending.current.delete(key);
        setGeneration((g) => g + 1);
      };
      img.onerror = () => {
        imagePending.current.delete(key);
      };
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tinted)}`;
    }
    return null;
    // Reads/writes only refs (always current) and the stable setState setter — no external values
    // to depend on, so this never needs recreating.
  }, []);

  return { get, generation };
}
