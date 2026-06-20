'use client';

import { MatchCard } from './MatchCard';
import { PlayerName } from './PlayerName';
import { isPlayedScore } from '@/lib/util';
import type { GauntletRound, GauntletMatch } from '@/lib/queries';

function computeGauntletRecords(matches: GauntletMatch[]) {
  const records = new Map<
    number,
    { player_id: number; name: string; wins: number; losses: number }
  >();
  for (const m of matches) {
    if (!isPlayedScore(m.final_score)) continue;
    for (const p of [...m.shirts_stats, ...m.skins_stats]) {
      const prev = records.get(p.player_id) ?? {
        player_id: p.player_id,
        name: p.player_name,
        wins: 0,
        losses: 0,
      };
      if (p.is_win) prev.wins++; else prev.losses++;
      records.set(p.player_id, prev);
    }
  }
  return Array.from(records.values()).sort(
    (a, b) => b.wins - a.wins || a.name.localeCompare(b.name),
  );
}

function GauntletRoundCard({
  round,
  allRounds,
  currentPlayerId,
  isOpen,
  onToggle,
}: {
  round: GauntletRound;
  allRounds: GauntletRound[];
  currentPlayerId: number | null;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const records = computeGauntletRecords(round.matches);
  const allPlayed =
    round.matches.length > 0 && round.matches.every((m) => isPlayedScore(m.final_score));
  const maxRoundNumber = Math.max(...allRounds.map((r) => r.round_number));
  const isFinalRound = round.round_number === maxRoundNumber;

  const playerIdsInLaterRounds = new Set<number>();
  for (const r of allRounds) {
    if (r.round_number <= round.round_number) continue;
    for (const m of r.matches) {
      for (const p of [...m.shirts_stats, ...m.skins_stats]) {
        playerIdsInLaterRounds.add(p.player_id);
      }
    }
  }

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] mb-4 last:mb-0">
      <button
        onClick={onToggle}
        className="lift-row w-full px-4 py-2.5 flex items-center gap-3 border-b border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-left"
        aria-expanded={isOpen}
      >
        <span className="text-[var(--color-text-secondary)] text-[12px] leading-none select-none w-3 shrink-0">
          {isOpen ? '−' : '+'}
        </span>
        <span className="tracked text-[11px] font-semibold text-[var(--color-text-primary)]">
          Round {round.round_number}
        </span>
      </button>

      {isOpen && (
        <>
          {round.matches.map((m, i) => {
            const played = isPlayedScore(m.final_score);
            return (
              <MatchCard
                key={m.id}
                href={`/matches/${m.id}`}
                map={m.shirts_pick ?? m.picked_map}
                label={{ type: 'game', gameNumber: i + 1 }}
                right={played ? { type: 'score', score: m.final_score! } : { type: 'pending' }}
                shirtsStats={m.shirts_stats}
                skinsStats={m.skins_stats}
                shirtsFallback={m.shirts_stats.map((p) => p.player_name).join(' & ') || 'Shirts TBD'}
                skinsFallback={m.skins_stats.map((p) => p.player_name).join(' & ') || 'Skins TBD'}
                currentPlayerId={currentPlayerId}
              />
            );
          })}

          {records.length > 0 && (
            <div className="border-t-2 border-[var(--color-border-primary)] px-4 py-3 bg-[var(--color-bg-secondary)]">
              <div className="tracked text-[9px] text-[var(--color-text-secondary)] mb-2">
                Results
              </div>
              <div className="flex flex-col gap-1.5">
                {records.map((r) => {
                  const advanced =
                    !isFinalRound && allPlayed && playerIdsInLaterRounds.has(r.player_id);
                  const eliminated =
                    !isFinalRound && allPlayed && !playerIdsInLaterRounds.has(r.player_id);
                  const isChampion =
                    isFinalRound &&
                    allPlayed &&
                    records[0]?.player_id === r.player_id &&
                    r.wins > r.losses;
                  return (
                    <div key={r.player_id} className="flex items-center justify-between gap-3">
                      <span
                        className="font-display text-[13px] font-semibold inline-flex items-center gap-1"
                        style={{
                          color: isChampion
                            ? 'var(--color-accent-amber-strong)'
                            : advanced
                              ? 'var(--color-accent-green-fg)'
                              : eliminated
                                ? 'var(--color-text-secondary)'
                                : 'var(--color-text-primary)',
                        }}
                      >
                        <PlayerName name={r.name} isMe={currentPlayerId !== null && r.player_id === currentPlayerId} />
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-mono text-[12px] tnum font-semibold ${
                            advanced || isChampion
                              ? 'text-[var(--color-accent-green-fg)]'
                              : eliminated
                                ? 'text-[var(--color-text-secondary)]'
                                : 'text-[var(--color-text-primary)]'
                          }`}
                        >
                          {r.wins}-{r.losses}
                        </span>
                        {advanced && (
                          <span className="tracked text-[9px] font-semibold px-1.5 py-0.5 border text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] border-[var(--color-accent-green-border)]">
                            Advanced
                          </span>
                        )}
                        {eliminated && (
                          <span className="tracked text-[9px] font-semibold px-1.5 py-0.5 border text-[var(--color-text-secondary)] bg-[var(--color-bg-secondary)] border-[var(--color-border-primary)]">
                            Eliminated
                          </span>
                        )}
                        {isChampion && (
                          <span className="tracked text-[9px] font-semibold px-1.5 py-0.5 border text-[var(--color-accent-amber-strong)] bg-[var(--color-accent-amber-bg)] border-[var(--color-accent-amber-border)]">
                            Champion
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function GauntletRoundsList({
  displayRounds,
  allRounds,
  openRounds,
  onToggleRound,
  currentPlayerId,
}: {
  displayRounds: GauntletRound[];
  allRounds: GauntletRound[];
  openRounds: Set<number>;
  onToggleRound: (roundNumber: number) => void;
  currentPlayerId: number | null;
}) {
  if (displayRounds.length === 0) {
    return (
      <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
        No matches found.
      </div>
    );
  }

  return (
    <div>
      {displayRounds.map((r) => (
        <GauntletRoundCard
          key={r.round_number}
          round={r}
          allRounds={allRounds}
          currentPlayerId={currentPlayerId}
          isOpen={openRounds.has(r.round_number)}
          onToggle={() => onToggleRound(r.round_number)}
        />
      ))}
    </div>
  );
}
