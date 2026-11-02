'use client';

import { useEffect } from 'react';
import { SHORT_DATE_FORMAT } from '@/lib/util';

/** Swaps `serverLabel` — a date the server wrote into the page title in a fixed timezone — for `iso`'s
 *  date in the viewer's own timezone (`SHORT_DATE_FORMAT`), once the page hydrates. Metadata can
 *  stream in after the page renders, and a refresh rewrites the title, so it re-swaps whenever the
 *  `<head>` changes. Renders nothing. */
export function LocalDateInTitle({ iso, serverLabel }: { iso: string; serverLabel: string }) {
  useEffect(() => {
    const local = new Date(iso).toLocaleDateString('en-US', SHORT_DATE_FORMAT);
    if (local === serverLabel) return;
    const swap = () => {
      if (document.title.includes(serverLabel)) document.title = document.title.replace(serverLabel, local);
    };
    swap();
    const observer = new MutationObserver(swap);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [iso, serverLabel]);
  return null;
}
