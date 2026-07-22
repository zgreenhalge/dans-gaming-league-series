'use client';

// Green live dot for the "Scrim" nav link — polls the same shared-server status the scrim page
// itself reads (`GET /api/scrim/status`) and shows the `LiveDot` used elsewhere for "server on".
// Only lights up for an actual scrim: a server that's up but held by a league match (`active`) isn't
// a scrim you can join, so it's excluded the same way `ScrimPanel` itself branches on `active`.
// Only polls for signed-in players, since the endpoint is session-gated.

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { LiveDot } from '@/components/ServerStatusBits';
import { isServerLive } from '@/lib/util';
import type { ScrimStatus } from '@/app/api/scrim/status/route';

const POLL_MS = 15_000;

export function ScrimNavStatus() {
  const { data: session } = useSession();
  const signedIn = !!session?.user?.playerId;
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/scrim/status');
        if (!res.ok) return;
        const status = (await res.json()) as ScrimStatus;
        if (!cancelled) setLive(isServerLive(status.server) && !status.active);
      } catch {
        // Leave the last-known state — a transient fetch failure shouldn't flicker the dot.
      }
    };
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [signedIn]);

  if (!signedIn || !live) return null;
  return <LiveDot />;
}
