/** One admin feedback mutation: sends `body` as JSON and throws the server's error message on a
 *  non-2xx, so a caller can hand it straight to `useAsyncAction().run()`. */
export async function sendFeedbackRequest(method: 'POST' | 'PATCH' | 'DELETE', url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Request failed.');
  }
}
