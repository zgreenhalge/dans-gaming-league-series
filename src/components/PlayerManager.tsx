'use client';

// Admin player console (#144): a searchable table of every player with name / admin / Steam-link
// shown up front, each editable in place via PlayerRow → `PATCH /api/players/[id]`. The EHOG
// "recompute now" control lives here too — ratings are player-scoped, so this is its natural home.

import { useMemo, useState } from 'react';
import type { Player } from '@/lib/types';
import { PlayerRow } from './PlayerRow';
import { RecomputeButton } from './RecomputeButton';

/** Lowercased searchable text for a player: name, steam nickname, steam id, and `#id`. Token-AND. */
function searchText(p: Player): string {
  return [p.name, p.steam_nickname, p.steam_id, `#${p.id}`].filter(Boolean).join(' ').toLowerCase();
}

const th = 'px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]';

export function PlayerManager({ players, selfId }: { players: Player[]; selfId: number | null }) {
  const [query, setQuery] = useState('');

  const indexed = useMemo(() => players.map((p) => ({ p, text: searchText(p) })), [players]);

  const filtered = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return players;
    return indexed.filter(({ text }) => tokens.every((t) => text.includes(t))).map(({ p }) => p);
  }, [indexed, players, query]);

  return (
    <>
      <section className="mb-8 border border-[var(--color-border-tertiary)] rounded px-4 py-4">
        <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">
          EHOG ratings
        </div>
        <RecomputeButton />
      </section>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name / steam nickname / steam id…"
        className="w-full font-mono text-[13px] px-3 py-2 mb-4 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] rounded focus:outline-none focus:border-[var(--color-text-secondary)]"
      />

      {filtered.length === 0 ? (
        <div className="font-mono text-[13px] text-[var(--color-text-secondary)] border border-[var(--color-border-tertiary)] rounded px-4 py-8 text-center">
          No players found.
        </div>
      ) : (
        <div className="border border-[var(--color-border-tertiary)] rounded overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-border-tertiary)]">
                <th className={th}>Player</th>
                <th className={th}>Admin</th>
                <th className={th}>Steam name</th>
                <th className={th}>Steam ID</th>
                <th className={`${th} text-right`}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <PlayerRow key={p.id} player={p} isSelf={p.id === selfId} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="font-mono text-[10px] text-[var(--color-text-secondary)] mt-3">
        Admin changes apply to admin pages immediately; a player&apos;s own Topbar admin link updates
        on their next login. Nickname and avatar refresh from Steam automatically after a link change.
      </div>
    </>
  );
}
