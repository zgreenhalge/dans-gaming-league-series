'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sendJsonRequest } from './sendJsonRequest';
import { useAsyncAction } from './useAsyncAction';

/** A mutation from a client component: `act()` sends the JSON request (`sendJsonRequest()`), then
 *  refreshes the page so its server components show the result — after a refusal too, since one
 *  usually means the page is out of date (a scrim match someone else changed answers "This match was
 *  changed — reloaded"). `busy` and `error` are `useAsyncAction()`'s. */
export function useRefreshingAction() {
  const router = useRouter();
  const { busy, error, run } = useAsyncAction();
  const [, startTransition] = useTransition();
  const act = (method: 'POST' | 'PATCH' | 'DELETE', url: string, body: unknown = {}) =>
    run(async () => {
      try {
        await sendJsonRequest(method, url, body);
      } finally {
        startTransition(() => router.refresh());
      }
    });
  return { busy, error, act };
}
