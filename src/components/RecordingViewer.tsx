"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Parse a YouTube video ID out of the URL a user pastes from the browser bar or the
// "Share" button. Returns null for anything that isn't a recognizable YouTube URL, so
// the caller can reject bad input instead of storing garbage.
function parseVideoIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.host.toLowerCase();
    const path = parsed.pathname.replace(/\/$/, '');

    if (host === 'www.youtube.com' || host === 'youtube.com') {
      // https://www.youtube.com/watch?v=VIDEO_ID
      const v = parsed.searchParams.get('v');
      if (v) return v;
      // https://www.youtube.com/embed/VIDEO_ID
      const match = path.match(/^\/embed\/([A-Za-z0-9_-]+)$/);
      return match ? match[1] : null;
    }

    if (host === 'youtu.be') {
      // Share-button form: https://youtu.be/VIDEO_ID
      const match = path.match(/^\/([A-Za-z0-9_-]+)$/);
      return match ? match[1] : null;
    }

    return null;
  } catch {
    return null;
  }
}

// Embedded player for a saved recording. `videoId` is the bare YouTube ID stored in
// matches.recording_url.
export function RecordingViewer({ videoId }: { videoId: string | null }) {
  if (!videoId) return null;
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] overflow-hidden">
      <iframe
        src={`https://www.youtube.com/embed/${videoId}`}
        title="Match recording"
        className="w-full aspect-video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
      />
    </div>
  );
}

// Admin/in-match control to set or clear a match's recording. Gated by the caller —
// only rendered when the current user may edit results (see MatchTabView). When a recording
// already exists this collapses to a "Replace Recording" link so it doesn't crowd the player.
export function RecordingUrlForm({ matchId, videoId }: { matchId: number; videoId: string | null }) {
  const router = useRouter();
  const hasRecording = !!videoId;
  const currentUrl = videoId ? `https://youtu.be/${videoId}` : null;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [editing, setEditing] = useState(false);

  async function save(value: string | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/matches/${matchId}/recording`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed to save recording.");
        return false;
      }
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseVideoIdFromUrl(text.trim());
    if (!parsed) {
      setError("Enter a valid YouTube link (youtube.com/watch or youtu.be).");
      return;
    }
    if (await save(parsed)) {
      setText("");
      setEditing(false);
    }
  }

  async function handleClear() {
    if (await save(null)) {
      setText("");
      setShowClearConfirm(false);
    }
  }

  const linkCls =
    "tracked text-[10px] hover:underline underline-offset-2 transition-colors self-start disabled:opacity-40";

  const clearConfirm = showClearConfirm && (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-strong)] px-4"
      onClick={() => setShowClearConfirm(false)}
    >
      <div
        className="w-full max-w-sm border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-4 font-display text-[15px] text-[var(--color-text-primary)]">
          Remove this recording?
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowClearConfirm(false)}
            disabled={busy}
            className="tracked text-[11px] font-semibold px-3 py-2 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={busy}
            className="tracked text-[11px] font-semibold px-3 py-2 border border-[var(--color-accent-red-border)] text-[var(--color-accent-red-fg)] bg-[var(--color-accent-red-bg)] hover:brightness-110 transition-all disabled:opacity-40"
          >
            {busy ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );

  // Collapsed: a recording exists and we're not editing — show the controls as links.
  if (hasRecording && !editing) {
    return (
      <>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => { setError(null); setEditing(true); }}
            className={`${linkCls} text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]`}
          >
            Replace Recording
          </button>
          <button
            type="button"
            onClick={() => setShowClearConfirm(true)}
            className={`${linkCls} text-[var(--color-accent-red-fg)] hover:brightness-110`}
          >
            Remove
          </button>
        </div>
        {clearConfirm}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="tracked text-[10px] text-[var(--color-text-secondary)]">
        {hasRecording ? "Replace Recording" : "Add Recording"}
      </div>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
        <input
          id="match-recording"
          type="url"
          value={text}
          placeholder={currentUrl ?? "Paste a YouTube link"}
          onChange={(e) => setText(e.target.value)}
          className="flex-1 min-w-[220px] font-mono text-[13px] px-3 py-2 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] placeholder:opacity-50 focus:outline-none focus:border-[var(--color-text-secondary)]"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="tracked text-[11px] font-semibold px-4 py-2 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:brightness-110 transition-all disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {hasRecording && (
          <button
            type="button"
            onClick={() => { setEditing(false); setText(""); setError(null); }}
            disabled={busy}
            className="tracked text-[11px] font-semibold px-4 py-2 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
        )}
      </form>

      {error && (
        <div className="font-mono text-[12px] text-[var(--color-accent-red-fg)]">{error}</div>
      )}

      {clearConfirm}
    </div>
  );
}
