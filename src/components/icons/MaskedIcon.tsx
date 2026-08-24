import type { CSSProperties } from 'react';

/**
 * Tints a static SVG file via a CSS mask instead of inlining it as JSX — the right call once an
 * icon set gets large or any individual file gets detailed (see `WeaponIcon`'s ~30 files, some
 * tens of KB): masking keeps the component lean regardless of source-file size, at the cost of
 * losing per-shape control (fine for a flat silhouette icon). Tint follows `currentColor` exactly
 * like the inlined icon components (`ConditionIcons`, `SideIcons`) — set `color` via `className`
 * or `style` on this element or an ancestor.
 */
export function MaskedIcon({
  src,
  size,
  className,
  style,
}: {
  src: string;
  size: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: 'inline-block',
        width: size,
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
