'use client';

import { useEffect } from 'react';

/** Swaps `serverLabel` — a date the server wrote into the page title, in a fixed timezone — for
 *  `iso`'s date in the viewer's own timezone, once the page hydrates. Renders nothing. */
export function LocalDateInTitle({ iso, serverLabel, opts }: { iso: string; serverLabel: string; opts: Intl.DateTimeFormatOptions }) {
  useEffect(() => {
    const local = new Date(iso).toLocaleDateString('en-US', opts);
    if (local !== serverLabel) document.title = document.title.replace(serverLabel, local);
  }, [iso, serverLabel, opts]);
  return null;
}
