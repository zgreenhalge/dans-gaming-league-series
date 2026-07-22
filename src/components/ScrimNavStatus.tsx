'use client';

// Green live dot for the "Scrim" nav link — derives from the same shared-server status
// `ScrimStatusProvider` polls (`GET /api/scrim/status`), rather than polling it independently, and
// shows the `LiveDot` used elsewhere for "server on". Only lights up for an actual scrim: a server
// that's up but held by a league match (`active`) isn't a scrim you can join, so it's excluded the
// same way `ScrimPanel` itself branches on `active`. Only rendered for signed-in players, since the
// status provider only polls for them.

import { useSession } from 'next-auth/react';
import { LiveDot } from '@/components/ServerStatusBits';
import { isServerLive } from '@/lib/util';
import { useScrimStatus } from '@/components/ScrimStatusContext';

export function ScrimNavStatus() {
  const { data: session } = useSession();
  const signedIn = !!session?.user?.playerId;
  const { status } = useScrimStatus();

  if (!signedIn || !status) return null;
  const live = isServerLive(status.server) && !status.active;
  if (!live) return null;
  return <LiveDot />;
}
