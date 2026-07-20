'use client';

import type { ReplayTheme } from '@/lib/replay/draw';

/** Read a CSS custom property off an element, falling back to a literal. */
export function cssVar(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

/** Grenade-effect colors shared between the live replay's status effects, its pen
 *  tool's grenade stickers, and `readTheme()`'s smoke/fire/he fields below — one
 *  source of truth so a sticker always matches the color the real effect draws in. */
export const STICKER_COLORS = { smoke: '#9aa0ab', molotov: '#e5642d', he: '#d8d24b' } as const;

/**
 * The shared canvas color theme, read from the page's CSS custom properties so every
 * replay-family canvas (2D Replay, Map Heatmap, Player Trails overlay) tracks the live
 * light/dark toggle identically instead of each reading its own subset once.
 */
export function readTheme(el: Element): ReplayTheme {
  return {
    bg: cssVar(el, '--color-bg-secondary', '#0b0e14'),
    grid: cssVar(el, '--color-border-tertiary', '#1c2230'),
    ct: cssVar(el, '--color-ct', '#5b9bd5'),
    t: cssVar(el, '--color-t', '#d5a04b'),
    text: cssVar(el, '--color-text-primary', '#e6e6e6'),
    textDim: cssVar(el, '--color-text-secondary', '#8a8f98'),
    bomb: '#f59e0b',
    tracer: '#e5484d',
    smoke: STICKER_COLORS.smoke,
    fire: STICKER_COLORS.molotov,
    flash: '#e8e6c8',
    he: STICKER_COLORS.he,
    decoy: '#6b8fd5',
  };
}
