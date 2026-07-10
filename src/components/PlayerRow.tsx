'use client';

// One row of the admin player table: shows a player's name, admin flag, seed EHOG, and Steam link
// (nickname / id / action in their own columns) up front, and edits them in place via
// `PATCH /api/players/[id]`. Name and seed EHOG edits sit behind a pencil; the rare manual "set
// SteamID64" drops into the Steam ID cell when you click Link — so a row stays compact until you
// act on it.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Player } from '@/lib/types';

const cellBtn =
  'font-mono text-[11px] px-2 py-0.5 rounded border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40';

const muted = 'font-mono text-[11px] text-[var(--color-text-secondary)]';

export function PlayerRow({ player, isSelf }: { player: Player; isSelf: boolean }) {
  const router = useRouter();
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(player.name);
  const [linking, setLinking] = useState(false);
  const [steamVal, setSteamVal] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingSeed, setEditingSeed] = useState(false);
  const [seedVal, setSeedVal] = useState(player.seed_ehog != null ? String(player.seed_ehog) : '');

  // Send one field-set to the player route; `key` labels the in-flight control. On success refresh
  // the server data and drop back to the read-only view.
  async function patch(key: string, body: Record<string, unknown>) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/players/${player.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? 'Failed to update');
        return false;
      }
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function saveName() {
    const next = nameVal.trim();
    if (next === '' || next === player.name) {
      setEditingName(false);
      return;
    }
    if (await patch('name', { name: next })) setEditingName(false);
  }

  async function setSteam() {
    const next = steamVal.trim();
    if (!/^\d{17}$/.test(next)) return;
    if (await patch('steam', { steam_id: next })) {
      setLinking(false);
      setSteamVal('');
    }
  }

  const steamValid = /^\d{17}$/.test(steamVal.trim());

  async function saveSeed() {
    const trimmed = seedVal.trim();
    if (trimmed === '') {
      if (player.seed_ehog == null) {
        setEditingSeed(false);
        return;
      }
      if (await patch('seed', { seed_ehog: null })) setEditingSeed(false);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 10 || parsed >= 100) return;
    if (await patch('seed', { seed_ehog: parsed })) setEditingSeed(false);
  }

  const seedTrimmed = seedVal.trim();
  const seedValid = seedTrimmed === '' || (Number.isFinite(Number(seedTrimmed)) && Number(seedTrimmed) > 10 && Number(seedTrimmed) < 100);

  return (
    <>
      <tr className="border-b border-[var(--color-border-tertiary)] last:border-b-0 hover:bg-[var(--color-bg-secondary)]">
        {/* Name */}
        <td className="px-3 py-2 align-middle">
          {editingName ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={nameVal}
                autoFocus
                onChange={(e) => setNameVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName();
                  if (e.key === 'Escape') { setNameVal(player.name); setEditingName(false); }
                }}
                className="w-36 font-mono text-[13px] px-1.5 py-0.5 border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] rounded focus:outline-none focus:border-[var(--color-text-secondary)]"
              />
              <button onClick={saveName} disabled={busy === 'name'} className={cellBtn}>
                {busy === 'name' ? '…' : 'Save'}
              </button>
              <button onClick={() => { setNameVal(player.name); setEditingName(false); }} className={cellBtn}>✕</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-display text-[14px] font-semibold">{player.name}</span>
              <button
                onClick={() => { setNameVal(player.name); setEditingName(true); }}
                aria-label="Edit name"
                className="font-mono text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              >
                ✎
              </button>
              <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">#{player.id}</span>
              {isSelf && <span className="font-mono text-[10px] text-[var(--color-accent-blue-fg)]">you</span>}
            </div>
          )}
        </td>

        {/* Admin */}
        <td className="px-3 py-2 align-middle">
          <button
            onClick={() => patch('admin', { is_admin: !player.is_admin })}
            disabled={busy === 'admin' || (isSelf && player.is_admin)}
            aria-pressed={player.is_admin}
            title={isSelf && player.is_admin ? "You can't remove your own admin access" : undefined}
            className={`font-mono text-[11px] px-2 py-0.5 rounded border transition-colors disabled:opacity-50 ${
              player.is_admin
                ? 'border-[var(--color-accent-amber-border)] bg-[var(--color-accent-amber-bg)] text-[var(--color-accent-amber-fg)]'
                : 'border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {busy === 'admin' ? '…' : player.is_admin ? '★ admin' : '☆'}
          </button>
        </td>

        {/* Seed EHOG — starting rating for a known new player, until their first rated match */}
        <td className="px-3 py-2 align-middle">
          {editingSeed ? (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                inputMode="decimal"
                value={seedVal}
                autoFocus
                placeholder="10–100"
                onChange={(e) => setSeedVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveSeed();
                  if (e.key === 'Escape') { setSeedVal(player.seed_ehog != null ? String(player.seed_ehog) : ''); setEditingSeed(false); }
                }}
                className="w-20 font-mono text-[13px] px-1.5 py-0.5 border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] rounded focus:outline-none focus:border-[var(--color-text-secondary)]"
              />
              <button onClick={saveSeed} disabled={!seedValid || busy === 'seed'} className={cellBtn}>
                {busy === 'seed' ? '…' : 'Save'}
              </button>
              <button onClick={() => { setSeedVal(player.seed_ehog != null ? String(player.seed_ehog) : ''); setEditingSeed(false); }} className={cellBtn}>✕</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className={muted}>{player.seed_ehog != null ? player.seed_ehog : '—'}</span>
              <button
                onClick={() => { setSeedVal(player.seed_ehog != null ? String(player.seed_ehog) : ''); setEditingSeed(true); }}
                aria-label="Edit seed EHOG"
                className="font-mono text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              >
                ✎
              </button>
            </div>
          )}
        </td>

        {/* Steam nickname */}
        <td className="px-3 py-2 align-middle">
          <span className={muted}>{player.steam_id ? (player.steam_nickname ?? '(no nickname)') : '—'}</span>
        </td>

        {/* Steam ID — becomes the manual-link input while linking */}
        <td className="px-3 py-2 align-middle">
          {linking ? (
            <input
              type="text"
              inputMode="numeric"
              value={steamVal}
              autoFocus
              placeholder="SteamID64 (17 digits)"
              onChange={(e) => setSteamVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSteam();
                if (e.key === 'Escape') { setSteamVal(''); setLinking(false); }
              }}
              className="w-44 font-mono text-[12px] px-1.5 py-0.5 border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] rounded focus:outline-none focus:border-[var(--color-text-secondary)]"
            />
          ) : (
            <span className={muted}>{player.steam_id ?? '—'}</span>
          )}
        </td>

        {/* Action */}
        <td className="px-3 py-2 align-middle text-right whitespace-nowrap">
          {linking ? (
            <div className="flex items-center gap-1.5 justify-end">
              <button onClick={setSteam} disabled={!steamValid || busy === 'steam'} className={cellBtn}>
                {busy === 'steam' ? '…' : 'Set'}
              </button>
              <button onClick={() => { setSteamVal(''); setLinking(false); }} className={cellBtn}>✕</button>
            </div>
          ) : player.steam_id ? (
            <button
              onClick={() => patch('steam', { steam_id: null })}
              disabled={busy === 'steam'}
              className="font-mono text-[11px] px-2 py-0.5 rounded border border-[var(--color-accent-red-border)] text-[var(--color-accent-red-fg)] hover:bg-[var(--color-accent-red-bg)] transition-colors disabled:opacity-50"
            >
              {busy === 'steam' ? '…' : 'Unlink'}
            </button>
          ) : (
            <button onClick={() => { setSteamVal(''); setLinking(true); }} className={cellBtn}>Link</button>
          )}
        </td>
      </tr>

      {error && (
        <tr>
          <td colSpan={6} className="px-3 pb-2 font-mono text-[11px] text-[var(--color-accent-red-fg)]">
            {error}
          </td>
        </tr>
      )}
    </>
  );
}
