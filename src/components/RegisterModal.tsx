"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSession } from "next-auth/react";
import { useHasMounted } from "./useHasMounted";

type UnlinkedPlayer = { id: number; name: string };

export default function RegisterModal() {
  const { data: session, update } = useSession();
  const [unlinked, setUnlinked] = useState<UnlinkedPlayer[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const mounted = useHasMounted();

  const show = !!session?.user && session.user.playerId == null;

  useEffect(() => {
    if (!show) return;
    fetch("/api/players/register")
      .then((r) => r.json())
      .then((d) => setUnlinked(d.players ?? []))
      .catch(() => {});
  }, [show]);

  if (!show || !mounted) return null;

  const selectedPlayer = unlinked.find((p) => p.id === selectedId) ?? null;

  async function submit(payload: { existingPlayerId?: number; name?: string }) {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/players/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      await update({ playerId: data.playerId, playerName: data.playerName });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
      setConfirming(false);
    }
  }

  if (confirming && selectedPlayer) {
    return createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] rounded-lg p-8 w-full max-w-sm shadow-xl">
          <h2 className="font-display font-bold text-[18px] text-[var(--color-text-primary)] mb-3">
            Are you really{" "}
            <span className="text-[var(--color-ct)]">{selectedPlayer.name}</span>?
          </h2>
          <p className="text-[13px] text-[var(--color-text-secondary)] mb-6">
            Please don&apos;t make me edit the database…
          </p>
          {error && <p className="text-[12px] text-red-500 mb-3">{error}</p>}
          <div className="flex gap-3">
            <button
              onClick={() => submit({ existingPlayerId: selectedPlayer.id })}
              disabled={loading}
              className="flex-1 py-2 text-[13px] font-semibold rounded bg-[var(--color-ct)] text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
            >
              {loading ? "Linking…" : "Yes, that's me"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={loading}
              className="flex-1 py-2 text-[13px] font-semibold rounded border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              Go back
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] rounded-lg p-8 w-full max-w-sm shadow-xl">
        <h2 className="font-display font-bold text-[20px] text-[var(--color-text-primary)] mb-1">
          Welcome to DGLS
        </h2>
        <p className="text-[13px] text-[var(--color-text-secondary)] mb-6">
          You&apos;re logged in as{" "}
          <span className="font-medium">{session.user.name}</span> on Steam, but
          you&apos;re not on the roster yet.
        </p>

        <div className="flex flex-col gap-4">
          {unlinked.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="tracked text-[10px] text-[var(--color-text-secondary)]">
                I&apos;m an existing player
              </label>
              <select
                value={selectedId ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedId(val ? Number(val) : null);
                  if (val) setNewName("");
                }}
                className="w-full px-3 py-2 text-[13px] rounded border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-ct)]"
              >
                <option value="">Select your name…</option>
                {unlinked.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {unlinked.length > 0 && (
            <div className="flex items-center gap-3 text-[11px] text-[var(--color-text-secondary)]">
              <div className="flex-1 h-px bg-[var(--color-border-primary)]" />
              or
              <div className="flex-1 h-px bg-[var(--color-border-primary)]" />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="tracked text-[10px] text-[var(--color-text-secondary)]">
              I&apos;m new — add me to the roster
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (e.target.value) setSelectedId(null);
              }}
              placeholder="Your league name"
              maxLength={64}
              className="w-full px-3 py-2 text-[13px] rounded border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-ct)]"
            />
          </div>

          {error && <p className="text-[12px] text-red-500">{error}</p>}

          <button
            onClick={() => {
              if (selectedId != null) {
                setConfirming(true);
              } else {
                submit({ name: newName });
              }
            }}
            disabled={loading || (selectedId == null && !newName.trim())}
            className="w-full py-2 text-[13px] font-semibold rounded bg-[var(--color-ct)] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {loading ? "Saving…" : selectedId != null ? "Link Account" : "Join the Roster"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
