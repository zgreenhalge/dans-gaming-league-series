'use client';

import { useEffect, useState } from 'react';

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'starting now';
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const hms = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  if (days === 1) return `1 day ${hms}`;
  if (days > 1) return `${days} days ${hms}`;
  return hms;
}

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
  return <div className={className}>in {formatCountdown(remaining)}</div>;
}
