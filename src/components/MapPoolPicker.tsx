'use client';

import { useState } from 'react';
import { toSentenceCase } from '@/lib/maps';
import { MAP_POOL_SIZE, type NewMap } from '@/lib/season-map-pool';
import EmptyState from './EmptyState';

/** Selection state for `MapPoolPicker`, owned by the parent so it can submit it. `newMaps` only
 * includes maps that are still selected. */
export function useMapPoolSelection(initial: string[] = []) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  const [addedMaps, setAddedMaps] = useState<NewMap[]>([]);
  return {
    selected,
    addedMaps,
    setSelected,
    setAddedMaps,
    mapPool: Array.from(selected),
    newMaps: addedMaps.filter((m) => selected.has(m.name)),
    /** An empty pool ("decide later") or a full one. */
    isValid: selected.size === 0 || selected.size === MAP_POOL_SIZE,
  };
}

export type MapPoolSelection = ReturnType<typeof useMapPoolSelection>;

interface Props {
  knownMaps: string[];
  selection: MapPoolSelection;
}

export function MapPoolPicker({ knownMaps, selection }: Props) {
  const { selected, addedMaps, setSelected, setAddedMaps } = selection;
  const [newMapName, setNewMapName] = useState('');
  const [newMapWorkshopUrl, setNewMapWorkshopUrl] = useState('');

  const allMaps = [...new Set([...knownMaps, ...addedMaps.map((m) => m.name)])].sort();

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
    if (!allMaps.includes(name)) {
      setAddedMaps((prev) => [...prev, { name, workshopUrl: url }]);
    }
    setSelected((prev) => new Set(prev).add(name));
    setNewMapName('');
    setNewMapWorkshopUrl('');
  }

  const countCls =
    selected.size === MAP_POOL_SIZE
      ? 'text-[var(--color-accent-green-fg)]'
      : selected.size > MAP_POOL_SIZE
        ? 'text-[var(--color-accent-red-fg,#f87171)]'
        : 'text-[var(--color-text-secondary)]';

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
          {allMaps.length === 0 && <EmptyState message="No maps found. Add one below." className="px-4 py-3" />}
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
      <div className={`font-mono text-[12px] ${countCls}`}>
        {selected.size} / {MAP_POOL_SIZE} maps selected
      </div>
    </div>
  );
}
