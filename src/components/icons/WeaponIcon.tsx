import type { CSSProperties } from 'react';
import { MaskedIcon } from './MaskedIcon';
import { weaponIconSrc } from '@/lib/weaponIcons';

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
  return <MaskedIcon src={src} size={size} className={className} style={style} />;
}
