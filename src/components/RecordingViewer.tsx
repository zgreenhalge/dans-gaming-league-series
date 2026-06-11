// async function handleYoutubeURL(url: string) {
//   const res = await fetch(`/api/matches/${matchId}/youtube`, { method: 'POST', body: JSON.stringify({ url }) });
//   if (!res.ok) {
//     const json = await res.json().catch(() => ({}));
//     setError(json.error ?? 'Failed to add YouTube URL.');
//     return;
//   }
// }
function removeUploadedURL() {
  // Pop-up to confirm, then set URL to null in database
}

function submitURL(url: string) {
  // Submit the URL to the backend

}

function checkURL(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.host.toLowerCase();
    const path = parsed.pathname.replace(/\/$/, '');

    if (host === 'www.youtube.com' || host === 'youtube.com') {
      const match = path.match(/^\/embed\/([A-Za-z0-9_-]+)$/);
      return match !== null && Boolean(match[1]);
    }

    if (host === 'youtu.be') {
      const match = path.match(/^\/([A-Za-z0-9_-]+)$/);
      return match !== null && Boolean(match[1]);
    }

    return false;
  } catch (e) {
    return false;
  }
}


export async function SubmitRecordingURL(
  { matchId }: { matchId: number },
  { url }: { url: string }
) {
  const form = new FormData();
  form.append('url', url)
  const res = await fetch(`/api/matches/${matchId}/recording`, { method: 'POST', body: form });
}
//   return (
//     <div className="flex items-center justify-center py-8">
//       <form> 
//         <input
//           type="text"
//           placeholder="Enter YouTube URL"
//           className="border rounded py-2 px-4 bg-[var(--color-bg-primary)]"
//         />
//         <input
//           type="submit"
//           className="ml-2 bg-[var(--color-ct)] text-white py-2 px-4 rounded"
//         />
//       </form>
//       <button
//         onClick={() => removeUploadedURL()}
//         className="ml-2 bg-[var(--color-t)] text-white py-2 px-4 rounded"
//       >
//         Remove
//       </button>
//     </div>
//   )
// }


export function RecordingViewer(
  {embedURL}: {embedURL: string | null}
) {
  // Embedded video player
  return (
    embedURL ? (
      <div className="flex items-center justify-center py-8">
        <iframe
          width="560"
          height="315"
          src={embedURL}
          className="border rounded"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        >
        </iframe>
      </div>
    ) : null
  );
}
