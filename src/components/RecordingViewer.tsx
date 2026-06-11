"use client";
import { useState } from "react";


function parseEmbedCodeFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.host.toLowerCase();
    const path = parsed.pathname.replace(/\/$/, '');

    if (host === 'www.youtube.com' || host === 'youtube.com') {
      const match = path.match(/^\/embed\/([A-Za-z0-9_-]+)$/);
      return match ? match[1] : null;
    }

    if (host === 'youtu.be') {
      const match = path.match(/^\/([A-Za-z0-9_-]+)$/);
      return match ? match[1] : null;
    }

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
          width="560"
          height="315"
          src={`https://www.youtube.com/embed/${embedCode}`}
          className="border rounded"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
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

  const handleSubmit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const embedCode = parseEmbedCodeFromUrl(text) ? parseEmbedCodeFromUrl(text) : null;
    setIsSaving(true);
    await fetch(`/api/matches/${matchId}/recording`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId, value: embedCode }),
    });
    setIsSaving(false);
    setText("");
  };

  const handleClear = async () => {
    setIsSaving(true);
    await fetch(`/api/matches/${matchId}/recording`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId, value: null }),
    });
    setText("");
    setIsSaving(false);
  };

  return (
    <div className="flex items-center justify-center py-8">
      <form onSubmit={handleSubmit}>
        <input
          id="match-recording"
          className="border rounded py-2 px-4"
          defaultValue={text}
          onChange={(e) => setText(e.target.value)}
          />

        <button type="submit" disabled={isSaving} className="bg-blue-500 text-white py-2 px-4 rounded">
          Save
        </button>
        <button type="button" onClick={handleClear} disabled={isSaving} className="bg-red-500 text-white py-2 px-4 rounded">
          Remove
        </button>
      </form>
    </div>
  );
}