'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sendJsonRequest } from './sendJsonRequest';
import { useAsyncAction } from './useAsyncAction';

/** A mutation from a client component: `act()` sends the JSON request (`sendJsonRequest()`), then
 *  refreshes the page so its server components show the result. `busy` and `error` are
 *  `useAsyncAction()`'s. */
export function useRefreshingAction() {
  const router = useRouter();
  const { busy, error, run } = useAsyncAction();
  const [, startTransition] = useTransition();
  const act = (method: 'POST' | 'PATCH' | 'DELETE', url: string, body: unknown = {}) =>
    run(async () => {
      await sendJsonRequest(method, url, body);
      startTransition(() => router.refresh());
    });
  return { busy, error, act };
}
