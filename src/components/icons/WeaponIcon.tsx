import type { CSSProperties } from 'react';
import { MaskedIcon } from './MaskedIcon';
import { weaponIconSrc, weaponIconAspect } from '@/lib/weaponIcons';

/** `size` is the icon's height; width is derived from the source SVG's own aspect ratio so
 *  landscape weapon icons (rifles especially) render at their full width instead of being
 *  letterboxed down to fit a square box. */
export function WeaponIcon({
  weapon,
  size,
  className,
  style,
}: {
  weapon: string | null | undefined;
  size: number;
  className?: string;
  style?: CSSProperties;
}) {
  const src = weaponIconSrc(weapon);
  if (!src) return null;
  const width = size * weaponIconAspect(weapon);
  return <MaskedIcon src={src} size={size} width={width} className={className} style={style} />;
}
