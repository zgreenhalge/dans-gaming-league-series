'use client';

// Small presentational bits for rendering raw DatHost server state in the admin server console
// (`ServerConsolePanel`).

import { useState } from 'react';
import { Copy, Check, Play } from 'lucide-react';
import type { DathostServer } from '@/lib/dathost';
import type { ConnectedPlayer } from '@/lib/server-players';
import { isServerLive, isServerOff } from '@/lib/util';

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
  const label = isServerLive(server) ? 'on' : isServerOff(server) ? 'off' : 'booting';
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

function CopyConnectButton({ connect }: { connect: string }) {
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

function JoinServerButton({ connect }: { connect: string }) {
  return (
    // `steam://connect/<host>` is unreliable from a browser click (a Steam client bug, independent of
    // host format) — `steam://run/730//+connect <ip:port>` (730 = CS2) is the documented workaround
    // that still launches reliably.
    <a
      href={`steam://run/730//+connect ${connect}`}
      title="Join server"
      className="inline-flex items-center text-[var(--color-text-secondary)] hover:text-[var(--color-accent-green-fg)]"
    >
      <Play size={12} />
    </a>
  );
}

/**
 * The connect-related bits shown for a live/connectable server — a one-click Steam join icon right in
 * front of the connect string + copy button. Renders inline (no wrapping element) so callers lay it out in their own flex row
 * alongside anything else they show (e.g. admin's `mode` field) — same pattern as
 * `MapPicker`/`LaunchOptionsPicker`.
 */
export function ServerConnectionDetails({
  connect,
  serverOn,
}: {
  connect: string | null;
  serverOn: boolean;
}) {
  if (!connect) return null;
  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        {serverOn && <JoinServerButton connect={connect} />}
        connect {connect}
        <CopyConnectButton connect={connect} />
      </span>
    </>
  );
}

/**
 * The currently-connected roster — "who's on the box" as a name list, not a bare count. `highlight`
 * tints the heading amber for the "casual use" signal (someone connected outside a DGLS match).
 */
export function ConnectedRoster({ connectedPlayers, highlight }: { connectedPlayers: ConnectedPlayer[]; highlight?: boolean }) {
  return (
    <div>
      <div
        className={`font-mono text-[12px] mb-2 ${highlight ? 'text-[var(--color-accent-amber-fg)]' : 'text-[var(--color-text-secondary)]'}`}
      >
        Connected {connectedPlayers.length > 0 && `(${connectedPlayers.length})`}
      </div>
      {connectedPlayers.length === 0 ? (
        <div className="font-mono text-[13px] text-[var(--color-text-secondary)]">No one connected yet.</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {connectedPlayers.map((p, i) => (
            <li key={`${p.steamId ?? 'pending'}-${i}`} className="font-mono text-[13px] text-[var(--color-text-primary)]">
              {p.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
