import { routeError } from '@/lib/util';

/** One mutation request from a client component: sends `body` as JSON and throws the server's error message on a
 *  non-2xx, so a caller can hand it straight to `useAsyncAction().run()`. Resolves to the response's JSON body
 *  (`null` when it has none). */
export async function sendJsonRequest<T = void>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await routeError(res, 'Request failed.'));
  return (await res.json().catch(() => null)) as T;
}
