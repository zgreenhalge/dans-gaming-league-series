'use client';

import { useEffect, useState } from 'react';

/** Every match id with a demo already ingested (`GET /api/admin/matches/demo-list`) — feeds both
 *  the match manager's per-row indicator and the quick-actions bulk-reparse button. `null` until the
 *  first fetch resolves. */
export function useDemoMatchIds(): Set<number> | null {
  const [ids, setIds] = useState<Set<number> | null>(null);

  useEffect(() => {
    fetch('/api/admin/matches/demo-list')
      .then((res) => (res.ok ? res.json() : null))
      .then((j: { matchIds?: number[] } | null) => {
        if (j?.matchIds) setIds(new Set(j.matchIds));
      })
      .catch(() => {});
  }, []);

  return ids;
}
