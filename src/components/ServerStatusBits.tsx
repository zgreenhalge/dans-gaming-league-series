'use client';

// Small presentational bits shared between the admin server console (`ServerConsolePanel`) and the
// public scrim panel (`ScrimPanel`) — both render the same raw DatHost server state.

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { DathostServer } from '@/lib/dathost';

export function StatePill({ configured, server }: { configured: boolean; server: DathostServer | null }) {
  if (!configured) {
    return (
      <span className="inline-block font-mono text-[11px] px-2 py-[2px] rounded border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)]">
        hosting not configured
      </span>
    );
  }
  if (!server) {
    return (
      <span
        className="inline-block font-mono text-[11px] px-2 py-[2px] rounded border"
        style={{
          backgroundColor: 'var(--color-accent-red-bg)',
          color: 'var(--color-accent-red-fg)',
          borderColor: 'var(--color-accent-red-border)',
        }}
      >
        unreachable
      </span>
    );
  }
  const label = server.booting ? 'booting' : server.on ? 'on' : 'off';
  const style =
    label === 'on'
      ? { bg: 'var(--color-accent-green-bg)', fg: 'var(--color-accent-green-fg)', border: 'var(--color-accent-green-border)' }
      : label === 'booting'
        ? { bg: 'var(--color-accent-amber-bg)', fg: 'var(--color-accent-amber-fg)', border: 'var(--color-accent-amber-border)' }
        : { bg: 'transparent', fg: 'var(--color-text-secondary)', border: 'var(--color-border-secondary)' };
  return (
    <span
      className="inline-block font-mono text-[11px] px-2 py-[2px] rounded border"
      style={{ backgroundColor: style.bg, color: style.fg, borderColor: style.border }}
    >
      {label}
    </span>
  );
}

export function LiveDot() {
  return (
    <span className="relative inline-flex h-[7px] w-[7px]" aria-hidden>
      <span
        className="absolute inline-flex h-full w-full rounded-full animate-ping opacity-75"
        style={{ backgroundColor: 'var(--color-accent-green-fg)' }}
      />
      <span
        className="relative inline-flex h-[7px] w-[7px] rounded-full"
        style={{ backgroundColor: 'var(--color-accent-green-fg)' }}
      />
    </span>
  );
}

export function CopyConnectButton({ connect }: { connect: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(`connect ${connect}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title={`Copy "connect ${connect}"`}
      className="inline-flex items-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}
