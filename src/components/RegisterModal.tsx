"use client";

import { useState, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
import { useHasMounted } from "./useHasMounted";
import Modal from "./Modal";

const subscribeNever = () => () => {};

/** The `claim` query param, read without a hydration mismatch — same technique as useHasMounted. */
function useClaimToken(): string | null {
  return useSyncExternalStore(
    subscribeNever,
    () => new URLSearchParams(window.location.search).get("claim"),
    () => null,
  );
}

/**
 * Reads the `name` riding along in a claim token for display only — the signature (and therefore
 * the `playerId` it protects) is re-verified server-side on submit, so a forged/expired name here
 * can only mislead the confirmation copy, never grant a link.
 */
function decodeClaimName(token: string): string | null {
  try {
    const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "===".slice((base64.length + 3) % 4);
    const { name } = JSON.parse(atob(padded));
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

export default function RegisterModal() {
  const { data: session, update } = useSession();
  const [dismissedClaim, setDismissedClaim] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const mounted = useHasMounted();

  const show = !!session?.user && session.user.playerId == null;
  const claimToken = useClaimToken();
  const claimName = claimToken !== null ? decodeClaimName(claimToken) : null;

  if (!show || !mounted) return null;

  async function submit(payload: { claim?: string; name?: string }) {
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
    }
  }

  const panelClassName =
    "bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] rounded-lg p-8 w-full max-w-sm shadow-xl";

  if (claimToken && claimName !== null && !dismissedClaim) {
    return (
      <Modal panelClassName={panelClassName}>
        <h2 className="font-display font-bold text-[18px] text-[var(--color-text-primary)] mb-3">
          Are you really{" "}
          <span className="text-[var(--color-ct)]">{claimName}</span>?
        </h2>
        <p className="text-[13px] text-[var(--color-text-secondary)] mb-6">
          Please don&apos;t make me edit the database…
        </p>
        {error && <p className="text-[12px] text-red-500 mb-3">{error}</p>}
        <div className="flex gap-3">
          <button
            onClick={() => submit({ claim: claimToken })}
            disabled={loading}
            className="flex-1 py-2 text-[13px] font-semibold rounded bg-[var(--color-ct)] text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {loading ? "Linking…" : "Yes, that's me"}
          </button>
          <button
            onClick={() => setDismissedClaim(true)}
            disabled={loading}
            className="flex-1 py-2 text-[13px] font-semibold rounded border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            Go back
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal panelClassName={panelClassName}>
      <h2 className="font-display font-bold text-[20px] text-[var(--color-text-primary)] mb-1">
        Welcome to DGLS
      </h2>
      <p className="text-[13px] text-[var(--color-text-secondary)] mb-6">
        You&apos;re logged in as{" "}
        <span className="font-medium">{session.user.name}</span> on Steam, but
        you&apos;re not on the roster yet.
      </p>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="tracked text-[10px] text-[var(--color-text-secondary)]">
            I&apos;m new — add me to the roster
          </label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Your league name"
            maxLength={64}
            className="w-full px-3 py-2 text-[13px] rounded border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-ct)]"
          />
        </div>

        <p className="text-[11px] text-[var(--color-text-secondary)]">
          Already on the roster from a past season? Ask an admin for your claim link instead of
          creating a new entry.
        </p>

        {error && <p className="text-[12px] text-red-500">{error}</p>}

        <button
          onClick={() => submit({ name: newName })}
          disabled={loading || !newName.trim()}
          className="w-full py-2 text-[13px] font-semibold rounded bg-[var(--color-ct)] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          {loading ? "Saving…" : "Join the Roster"}
        </button>
      </div>
    </Modal>
  );
}
