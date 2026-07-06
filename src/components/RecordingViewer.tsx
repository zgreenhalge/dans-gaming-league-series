"use client";
import { useState } from "react";


function parseEmbedCodeFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.host.toLowerCase();
    const path = parsed.pathname.replace(/\/$/, '');

    if (host === 'www.youtube.com' || host === 'youtube.com') {
      // Case 1: https://www.youtube.com/watch?v=VIDEO_ID
      const v = parsed.searchParams.get('v');
      if (v) return v;
      
      // Case 2: https://www.youtube.com/embed/VIDEO_ID
      const match = path.match(/^\/embed\/([A-Za-z0-9_-]+)$/);
      return match ? match[1] : null;
    }

    if (host === 'youtu.be') {
      // Pattern from the SHARE button link https://youtu.be/VIDEO_ID
      const match = path.match(/^\/([A-Za-z0-9_-]+)$/);
      return match ? match[1] : null;
    }

    // Non-Youtube hosts should do nothing
    return null;
  } catch (e) {
    return null;
  }
}


export function RecordingViewer(
  {embedURL: embedCode}: {embedURL: string | null}
) {
  // Embedded video player
  return (
    embedCode ? (
      <div className="flex items-center justify-center py-8">
        <iframe
          src={`https://www.youtube.com/embed/${embedCode}`}
          className="border rounded w-full aspect-video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        >
        </iframe>
      </div>
    ) : null
  );
}


export function RecordingUrlForm(
  { matchId }: {matchId: number}
) {
  const [text, setText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleSubmit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const embedCode = parseEmbedCodeFromUrl(text) ?? null;
    if (embedCode) {
      setIsSaving(true);
      await fetch(`/api/matches/${matchId}/recording`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: embedCode }),
      });
      setIsSaving(false);
    }
    setText("");
  };

  const handleClear = async () => {
    setIsSaving(true);
    await fetch(`/api/matches/${matchId}/recording`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: null }),
    });
    setText("");
    setIsSaving(false);
    setShowClearConfirm(false);
  };

  return (
    <div className="flex items-center justify-center py-8">
      <form onSubmit={handleSubmit}>
        <input
          id="match-recording"
          className="border rounded py-2 px-4"
          value={text}
          placeholder="Provide a YouTube URL"
          onChange={(e) => setText(e.target.value)}
          />

        <button type="submit" disabled={isSaving} className="bg-blue-500 text-[var(--color-text-primary)] py-2 px-4 rounded">
          Save
        </button>
        <button type="button" onClick={() => setShowClearConfirm(true)} disabled={isSaving} className="bg-red-500 text-[var(--color-text-primary)] py-2 px-4 rounded">
          Remove
        </button>
      </form>

      {showClearConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={() => setShowClearConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-4 text-sm text-gray-700">
              Are you sure?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClear}
                disabled={isSaving}
                className="rounded bg-red-500 px-3 py-2 text-sm text-[var(--color-text-primary)]"
              >
                {isSaving ? "Removing..." : "Yes, remove it."}
              </button>
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                disabled={isSaving}
                className="rounded bg-gray-200 px-3 py-2 text-sm text-[var(--color-text-secondary)]"
              >
                No, keep it.
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}