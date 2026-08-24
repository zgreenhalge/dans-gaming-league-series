import type { CSSProperties } from 'react';

/**
 * Tints a static SVG file via a CSS mask instead of inlining it as JSX — the right call once an
 * icon set gets large or any individual file gets detailed (see `WeaponIcon`'s ~30 files, some
 * tens of KB): masking keeps the component lean regardless of source-file size, at the cost of
 * losing per-shape control (fine for a flat silhouette icon). Tint follows `currentColor` exactly
 * like the inlined icon components (`ConditionIcons`, `SideIcons`) — set `color` via `className`
 * or `style` on this element or an ancestor.
 *
 * `size` sets the box height and, by default, its width too (square — right for the near-square
 * icons this was originally built for). Pass `width` explicitly to fit a landscape icon — e.g.
 * `WeaponIcon` derives it from the source SVG's own aspect ratio — so `mask-size: contain` has a
 * correctly-proportioned box to fill instead of letterboxing the icon down to fit a square one.
 */
export function MaskedIcon({
  src,
  size,
  width,
  className,
  style,
}: {
  src: string;
  size: number;
  width?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: 'inline-block',
        width: width ?? size,
        height: size,
        backgroundColor: 'currentColor',
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        ...style,
      }}
    />
  );
}
