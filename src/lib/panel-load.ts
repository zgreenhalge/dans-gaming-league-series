import { unstable_rethrow } from 'next/navigation';

// Per-panel read isolation for pages made of independent panels (the admin console). Server reads
// throw when they fail, which on a one-page console would send every panel to the error boundary
// for one bad read. `loadPanel()` runs one panel's read and turns a failure into data the panel
// renders inline (`PanelGate`, src/components/PanelGate.tsx), so the rest of the page stays usable.
// Next.js control-flow errors (redirect, notFound, request-time bailouts) are rethrown, not shown.
// The failure is still surfaced — in the panel, and in the server log — never dropped.

/** A failed panel read: the error message and the panel's `label`, the one name the log line and the
 *  on-screen "Couldn't load {label}" both use. */
export type PanelFailure = { ok: false; error: string; label: string };

/** One panel's loaded data, or the failure of the read. Plain data, so it crosses the
 *  server → client component boundary. */
export type PanelData<T> = { ok: true; data: T } | PanelFailure;

/** Runs `read` and wraps its result; a rejection becomes `{ ok: false, error, label }` and is logged.
 *  `label` names the panel as it reads after "Couldn't load" ("the server status", "matches").
 *  Next.js control-flow errors propagate untouched. */
export async function loadPanel<T>(label: string, read: () => Promise<T>): Promise<PanelData<T>> {
  try {
    return { ok: true, data: await read() };
  } catch (err) {
    unstable_rethrow(err);
    // Supabase rejects with a plain `{ message }` object, not an `Error`.
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String(err.message)
          : String(err);
    console.error(`${label} failed to load:`, err);
    return { ok: false, error: message, label };
  }
}

/** Derives one panel's data from another's: `derive` runs on a loaded panel, and a failed one passes
 *  its error through under `label` — so a panel built on another's read fails visibly with it instead
 *  of rendering as if that read were empty. */
export function mapPanel<T, U>(panel: PanelData<T>, label: string, derive: (data: T) => U): PanelData<U> {
  return panel.ok ? { ok: true, data: derive(panel.data) } : { ...panel, label };
}
