'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toSentenceCase } from '@/lib/maps';

interface Props {
  knownMaps: string[];
}

type NewMap = { name: string; workshopUrl: string };

export function CreateSeasonForm({ knownMaps }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newMapName, setNewMapName] = useState('');
  const [newMapWorkshopUrl, setNewMapWorkshopUrl] = useState('');
  const [addedMaps, setAddedMaps] = useState<NewMap[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);

  const addedNames = addedMaps.map((m) => m.name);
  const allMaps = [...new Set([...knownMaps, ...addedNames])].sort();

  function toggle(map: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(map)) next.delete(map); else next.add(map);
      return next;
    });
  }

  function addNewMap() {
    const name = newMapName.trim().toLowerCase();
    const url = newMapWorkshopUrl.trim();
    if (!name || !url) return;
    if (allMaps.includes(name)) {
      setSelected((prev) => new Set(prev).add(name));
      setNewMapName('');
      setNewMapWorkshopUrl('');
      return;
    }
    setAddedMaps((prev) => [...prev, { name, workshopUrl: url }]);
    setSelected((prev) => new Set(prev).add(name));
    setNewMapName('');
    setNewMapWorkshopUrl('');
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/seasons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          map_pool: Array.from(selected),
          new_maps: addedMaps.filter((m) => selected.has(m.name)),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Failed to create season.');
        return;
      }
      const created = await res.json();
      startTransition(() => router.push(`/seasons/${created.id}`));
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || isPending;

  return (
    <div className="flex flex-col gap-8">
      {/* Map pool */}
      <div>
        <div className="tracked text-[10px] text-[var(--color-text-secondary)] mb-3">Map Pool</div>
        <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
          {allMaps.map((map) => (
            <label
              key={map}
              className="lift-row flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border-tertiary)] last:border-b-0 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(map)}
                onChange={() => toggle(map)}
                className="accent-[var(--color-site-accent)]"
              />
              <span className="font-display text-[15px] font-semibold">
                {toSentenceCase(map)}
              </span>
            </label>
          ))}
          {allMaps.length === 0 && (
            <div className="px-4 py-3 font-mono text-[12px] text-[var(--color-text-secondary)]">
              No maps found. Add one below.
            </div>
          )}
        </div>
      </div>

      {/* Add new map */}
      <div>
        <div className="tracked text-[10px] text-[var(--color-text-secondary)] mb-3">Add New Map</div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newMapName}
              onChange={(e) => setNewMapName(e.target.value)}
              placeholder="Map name"
              className="flex-1 font-mono text-[13px] px-3 py-2 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] placeholder:opacity-50 focus:outline-none focus:border-[var(--color-text-secondary)]"
            />
            <button
              type="button"
              onClick={addNewMap}
              disabled={!newMapName.trim() || !newMapWorkshopUrl.trim()}
              className={`tracked text-[10px] font-semibold px-3 py-2 border transition-colors ${
                newMapName.trim() && newMapWorkshopUrl.trim()
                  ? 'border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:brightness-110'
                  : 'border-[var(--color-border-primary)] text-[var(--color-text-secondary)] opacity-40'
              }`}
            >
              Add
            </button>
          </div>
          <input
            type="url"
            value={newMapWorkshopUrl}
            onChange={(e) => setNewMapWorkshopUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNewMap(); } }}
            placeholder="Steam Workshop URL"
            className="font-mono text-[13px] px-3 py-2 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] placeholder:opacity-50 focus:outline-none focus:border-[var(--color-text-secondary)]"
          />
        </div>
      </div>

      {/* Submit */}
      <div className="flex flex-col gap-3">
        <div className={`font-mono text-[12px] ${selected.size === 5 ? 'text-[var(--color-accent-green-fg)]' : selected.size > 5 ? 'text-[var(--color-accent-red-fg,#f87171)]' : 'text-[var(--color-text-secondary)]'}`}>
          {selected.size} / 5 maps selected
        </div>
        {error && (
          <div className="text-[12px] text-[var(--color-accent-red-fg,#f87171)]">{error}</div>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={busy || selected.size !== 5}
          className="tracked text-[11px] font-semibold px-4 py-2.5 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:brightness-110 transition-all disabled:opacity-40 self-start"
        >
          {busy ? 'Creating…' : 'Create Season'}
        </button>
      </div>
    </div>
  );
}
