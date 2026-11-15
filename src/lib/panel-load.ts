// Per-panel read isolation for pages made of independent panels (the admin console). Server reads
// throw when they fail, which on a one-page console would send every panel to the error boundary
// for one bad read. `loadPanel()` runs one panel's read and turns a failure into data the panel
// renders inline (`PanelGate`, src/components/PanelGate.tsx), so the rest of the page stays usable.
// The failure is still surfaced — in the panel, and in the server log — never dropped.

/** One panel's loaded data, or the message of the read that failed. Plain data, so it crosses the
 *  server → client component boundary. */
export type PanelData<T> = { ok: true; data: T } | { ok: false; error: string };

/** Runs `read` and wraps its result; a rejection becomes `{ ok: false, error }` and is logged. */
export async function loadPanel<T>(label: string, read: () => Promise<T>): Promise<PanelData<T>> {
  try {
    return { ok: true, data: await read() };
  } catch (err) {
    // Supabase rejects with a plain `{ message }` object, not an `Error`.
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String(err.message)
          : String(err);
    console.error(`[admin] ${label} failed to load:`, err);
    return { ok: false, error: message };
  }
}
