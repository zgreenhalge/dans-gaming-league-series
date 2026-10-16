'use client';

import { useEffect, useState } from 'react';
import { formatCountdownClock } from '@/lib/util';

export function CountdownTimer({ iso, className }: { iso: string; className?: string }) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const target = new Date(iso).getTime();
    const tick = () => setRemaining(target - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [iso]);

  if (remaining === null || remaining <= 0) return null;
  const urgent = remaining < 6 * 60 * 60 * 1000;
  const imminent = remaining < 60 * 60 * 1000;
  const urgentCls = urgent ? ' text-red-500' : '';
  const imminentCls = imminent ? ' font-bold' : '';
  return <div className={`${className ?? ''}${urgentCls}${imminentCls}`}>in {formatCountdownClock(remaining)}</div>;
}
