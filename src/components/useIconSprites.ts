'use client';

import { useCallback, useState } from 'react';
import type { IconSprite } from '@/lib/replay/draw';

/**
 * Preloads and caches CS2 icon SVGs as tinted, `ctx.drawImage()`-ready sprites, for the 2D
 * Replay canvas's kill feed and bomb marker. `draw.ts` runs inside a `requestAnimationFrame`
 * loop calling raw `CanvasRenderingContext2D` methods — it can't reference a static file URL the
 * way a DOM icon component does, and even if it could, a plain `<img>`/`fetch`'d SVG has no CSS
 * context for `currentColor` to resolve against, so every icon in `public/{weapon,grenade,
 * round}-icons/` would render solid black. This bakes the desired color directly into the SVG text
 * (a simple string replace — every icon in this codebase uses `currentColor` as its only fill) and
 * loads the result as a data-URI image, once per (src, color) pair, cached for reuse. Each
 * sprite's natural pixel size is read off the loaded bitmap (same convention as `useMapRadar`'s
 * radar image) so callers — weapon icons are landscape, not square — can fit it without distortion.
 *
 * The caches live at module scope, not in a ref, so they survive `ReplayPlayer` unmounting —
 * switching to the heatmap/trails/recording sub-tab and back would otherwise re-fetch, re-tint,
 * and re-decode every icon from scratch even though they're static assets that never change
 * within a session.
 *
 * `get()` returns `null` immediately for a pair that hasn't finished loading (or hasn't been
 * requested before) rather than blocking the draw call — callers fall back to their existing
 * shape/text rendering for that frame. `generation` increments each time a new sprite finishes
 * loading; a caller drives a repaint off it directly (e.g. `useEffect(() => draw(), [generation,
 * draw])`) so a *paused* frame — whose RAF loop only calls `draw()` once, not every frame — still
 * picks up the icon once it's ready instead of showing the fallback forever.
 */
const rawText = new Map<string, string>();
const rawPending = new Set<string>();
const sprites = new Map<string, IconSprite>();
const imagePending = new Set<string>();

export function useIconSprites(): {
  get: (src: string, color: string) => IconSprite | null;
  generation: number;
} {
  const [generation, setGeneration] = useState(0);

  const get = useCallback((src: string, color: string): IconSprite | null => {
    const key = `${src}::${color}`;
    const cached = sprites.get(key);
    if (cached) return cached;

    const text = rawText.get(src);
    if (text === undefined) {
      if (!rawPending.has(src)) {
        rawPending.add(src);
        fetch(src)
          .then((res) => res.text())
          .then((t) => {
            rawText.set(src, t);
            rawPending.delete(src);
            setGeneration((g) => g + 1);
          })
          .catch(() => {
            rawPending.delete(src);
          });
      }
      return null;
    }

    if (!imagePending.has(key)) {
      imagePending.add(key);
      const tinted = text.replaceAll('currentColor', color);
      const img = new Image();
      img.onload = () => {
        sprites.set(key, { image: img, width: img.naturalWidth, height: img.naturalHeight });
        imagePending.delete(key);
        setGeneration((g) => g + 1);
      };
      img.onerror = () => {
        imagePending.delete(key);
      };
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tinted)}`;
    }
    return null;
    // Reads/writes only module-scope caches and the stable setState setter — no external values
    // to depend on, so this never needs recreating.
  }, []);

  return { get, generation };
}
