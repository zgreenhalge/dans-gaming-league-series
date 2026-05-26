"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";

export default function RegisterModal() {
  const { data: session, update } = useSession();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Only show when authenticated but not yet linked to a player record
  if (!session?.user || session.user.playerId != null) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/players/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }

      // Refresh the session token so playerId is populated
      await update({ playerId: data.playerId, playerName: data.playerName });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] rounded-lg p-8 w-full max-w-sm shadow-xl">
        <h2 className="font-display font-bold text-[20px] text-[var(--color-text-primary)] mb-1">
          Welcome to DGLS
        </h2>
        <p className="text-[13px] text-[var(--color-text-secondary)] mb-6">
          You&apos;re logged in as <span className="font-medium">{session.user.name}</span> on
          Steam, but you&apos;re not on the roster yet. Enter the name you go by in the league.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your league name"
            maxLength={64}
            required
            className="w-full px-3 py-2 text-[13px] rounded border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-ct)]"
          />

          {error && (
            <p className="text-[12px] text-red-500">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full py-2 text-[13px] font-semibold rounded bg-[var(--color-ct)] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {loading ? "Registering…" : "Join the Roster"}
          </button>
        </form>
      </div>
    </div>
  );
}
