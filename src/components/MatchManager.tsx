'use client';

// Admin match-management console (#144): search for a match, expand it, and reschedule / clear-redo
// the pick-ban / toggle feature — all reusing the same editors and routes as the match page (no
// duplicate mutation logic). Score + stats editing intentionally stays on the match page (it's one
// coupled operation via /score).

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { isPlayedScore } from '@/lib/util';
import type { AdminMatchRow } from '@/lib/queries';
import type { ScheduledMatchRef } from '@/lib/schedule';
import VetoSequence from './VetoSequence';
import { ScheduleEditor } from './ScheduleEditor';
import { FeatureMatchToggle } from './FeatureMatchToggle';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">
      {children}
    </div>
  );
}

/** The map a match was played on — the pick lives in `shirts_pick`, falling back to `picked_map`. */
function mapFor(m: AdminMatchRow): string | null {
  return m.match.shirts_pick ?? m.match.picked_map;
}

/**
 * Lowercased searchable text for a match: its full label, shorthand tokens (`s1`/`s1g`/`w5`/`r3`/`m2`
 * — so "S1 W5 M2" works, not just the full "Season 1 · Wk 5"), the played map, and the score. Search
 * is token-AND (every whitespace-separated term must appear), so partial shorthand narrows the list.
 */
function searchText(m: AdminMatchRow): string {
  const parts = [m.label, mapFor(m), m.match.picked_map, m.match.shirts_pick, m.match.final_score];
  if (m.seasonNumber != null) parts.push(`s${m.seasonNumber}${m.isGauntlet ? 'g' : ''}`);
  if (m.weekNumber != null) {
    parts.push(`w${m.weekNumber}`);
    if (m.isGauntlet) parts.push(`r${m.weekNumber}`); // gauntlet weeks read as rounds
  }
  if (m.match.match_number != null) parts.push(`m${m.match.match_number}`);
  return parts.filter(Boolean).join(' ').toLowerCase();
}

export function MatchManager({ matches }: { matches: AdminMatchRow[] }) {
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);

  // All unplayed, non-gauntlet scheduled matches — the collision pool the schedule editor checks
  // against (built once from the loaded list, so no per-row fetch).
  const scheduledRefs: ScheduledMatchRef[] = useMemo(
    () =>
      matches
        .filter((m) => m.match.scheduled_at && !m.isGauntlet && !isPlayedScore(m.match.final_score))
        .map((m) => ({ id: m.match.id, scheduledAt: m.match.scheduled_at as string, label: m.label })),
    [matches],
  );

  // Precompute each match's searchable text once, not on every keystroke.
  const indexed = useMemo(() => matches.map((m) => ({ m, text: searchText(m) })), [matches]);

  const filtered = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return matches;
    return indexed.filter(({ text }) => tokens.every((t) => text.includes(t))).map(({ m }) => m);
  }, [indexed, matches, query]);

  return (
    <>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by season / week / match / map…"
        className="w-full font-mono text-[13px] px-3 py-2 mb-4 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] rounded focus:outline-none focus:border-[var(--color-text-secondary)]"
      />

      {filtered.length === 0 ? (
        <div className="font-mono text-[13px] text-[var(--color-text-secondary)] border border-[var(--color-border-tertiary)] rounded px-4 py-8 text-center">
          No matches found.
        </div>
      ) : (
        <div className="border border-[var(--color-border-tertiary)] rounded overflow-hidden">
          {filtered.map((m) => {
            const played = isPlayedScore(m.match.final_score);
            const isOpen = openId === m.match.id;
            const others = scheduledRefs.filter((r) => r.id !== m.match.id);
            return (
              <div key={m.match.id} className="border-b border-[var(--color-border-tertiary)] last:border-b-0">
                <button
                  onClick={() => setOpenId(isOpen ? null : m.match.id)}
                  aria-expanded={isOpen}
                  className="lift-row w-full grid grid-cols-[auto_1fr_auto] gap-2 items-center px-3 py-3 text-left"
                >
                  <span className="font-mono text-[11px] text-[var(--color-text-secondary)] w-3">{isOpen ? '▾' : '▸'}</span>
                  <div className="min-w-0">
                    <div className="font-display text-[15px] font-semibold truncate">
                      {m.match.is_feature_match && <span className="text-[var(--color-accent-amber-fg)]">★ </span>}
                      {m.label}
                    </div>
                    <div className="font-mono text-[11px] text-[var(--color-text-secondary)] flex flex-wrap gap-x-3 gap-y-1 mt-1">
                      <span>#{m.match.id}</span>
                      {mapFor(m) && <span>{mapFor(m)}</span>}
                      {played && m.match.final_score && <span>{m.match.final_score}</span>}
                      {m.isGauntlet && <span className="text-[var(--color-accent-amber-fg)]">gauntlet</span>}
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div className="px-3 py-4 flex flex-col gap-5 bg-[var(--color-bg-secondary)] border-t border-[var(--color-border-tertiary)]">
                    {!m.isGauntlet && !played && (
                      <section>
                        <SectionLabel>Schedule</SectionLabel>
                        <ScheduleEditor
                          matchId={m.match.id}
                          scheduledAt={m.match.scheduled_at}
                          weekStart={m.weekStart}
                          weekEnd={m.weekEnd}
                          otherScheduled={others}
                        />
                      </section>
                    )}

                    <section>
                      <SectionLabel>Pick / Ban</SectionLabel>
                      <VetoSequence
                        match={m.match}
                        mapPool={m.mapPool}
                        canVeto
                        isGauntlet={m.isGauntlet}
                        playerFaction={null}
                        gauntletPlayerIndex={null}
                        isAdmin
                      />
                    </section>

                    <section>
                      <SectionLabel>Feature match</SectionLabel>
                      <FeatureMatchToggle matchId={m.match.id} isFeature={m.match.is_feature_match} />
                    </section>

                    <Link
                      href={`/matches/${m.match.id}`}
                      className="font-mono text-[11px] text-[var(--color-accent-blue-fg)] hover:underline self-start"
                    >
                      open match page ↗
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
