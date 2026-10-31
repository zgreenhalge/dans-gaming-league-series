import type { ReactNode } from 'react';

/** Small site-accent status pill, e.g. an upcoming season's "Sign up now" or a scrim night's
 *  "You're in". */
export function AccentTag({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 tracked text-[10px] font-semibold border shrink-0"
      style={{
        color: 'var(--color-site-accent)',
        background: 'color-mix(in srgb, var(--color-site-accent) 12%, transparent)',
        borderColor: 'var(--color-site-accent)',
      }}
    >
      {children}
    </span>
  );
}
