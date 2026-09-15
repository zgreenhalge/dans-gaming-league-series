'use client';

import { useMemo } from 'react';
import EmptyState from './EmptyState';
import { MatchCard } from './MatchCard';
import { PlayerName } from './PlayerName';
import { allMatchesPlayed, isPlayedScore, GAUNTLET_POD_STAKES_LABEL, roundAnchorId } from '@/lib/util';
import { canonicalGauntletRankMap } from '@/lib/gauntlet-ranking';
import { computeAdvanceOrdinals, pendingSlotLabel, podMightBeMine, podsById as buildPodsById } from '@/lib/gauntlet-draft';
import type { GauntletRound, GauntletMatch, BracketPod } from '@/lib/queries';

// A stable reference for rounds with no pending pods — `pendingPodsByRound.get(...) ?? EMPTY_PODS`
// keeps GauntletRoundCard's `useMemo` dependency stable across renders instead of a fresh `[]`
// literal defeating it every time.
const EMPTY_PODS: BracketPod[] = [];

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

/** Groups a round's matches back into their pods (2 matches each), preserving match order.
 * Matches with no linked pod (gauntlets predating bracket scheduling) each stand alone with no
 * stakes label. */
function groupMatchesByPod(matches: GauntletMatch[]) {
  const groups: { pod_index: number | null; advance_rule: GauntletMatch['advance_rule']; matches: GauntletMatch[] }[] = [];
  const byPodIndex = new Map<number, (typeof groups)[number]>();
  for (const m of matches) {
    if (m.pod_index == null) {
      groups.push({ pod_index: null, advance_rule: null, matches: [m] });
      continue;
    }
    let g = byPodIndex.get(m.pod_index);
    if (!g) {
      g = { pod_index: m.pod_index, advance_rule: m.advance_rule, matches: [] };
      byPodIndex.set(m.pod_index, g);
      groups.push(g);
    }
    g.matches.push(m);
  }
  return groups;
}

type PodEntry =
  | { kind: 'real'; pod_index: number | null; advance_rule: GauntletMatch['advance_rule']; matches: GauntletMatch[] }
  | { kind: 'pending'; pod_index: number; advance_rule: BracketPod['advance_rule']; pod: BracketPod };

/** A round's pods, real and not-yet-materialized alike, in pod_index order — the merged view behind
 * the Schedule tab's placeholder rows (#528). A round can mix both: e.g. a wildcard pod that's fully
 * played feeding an elimination pod still waiting on the rest of its bracket to resolve. */
function buildPodEntries(matches: GauntletMatch[], pendingPods: BracketPod[]): PodEntry[] {
  const real: PodEntry[] = groupMatchesByPod(matches).map((g) => ({ kind: 'real', ...g }));
  const pending: PodEntry[] = pendingPods.map((pod) => ({ kind: 'pending', pod_index: pod.pod_index, advance_rule: pod.advance_rule, pod }));
  return [...real, ...pending].sort((a, b) => (a.pod_index ?? -1) - (b.pod_index ?? -1));
}

/** A not-yet-materialized pod's four slots — named the same way the Groups tab names an undecided
 * slot (`pendingSlotLabel`), since this pod has no real matches yet to render as `MatchCard`s. */
function PendingPodRows({
  pod,
  podsById,
  advanceOrdinals,
  seedNames,
  currentPlayerId,
}: {
  pod: BracketPod;
  podsById: Map<number, BracketPod>;
  advanceOrdinals: Map<string, number>;
  seedNames?: Map<number, string>;
  currentPlayerId: number | null;
}) {
  return (
    <div className="px-4 py-2 bg-[var(--color-bg-primary)] border-b border-[var(--color-border-tertiary)] last:border-b-0">
      <div className="tracked text-[9px] text-[var(--color-text-secondary)] mb-1.5">Not yet scheduled</div>
      <div className="flex flex-col gap-1">
        {pod.slots.map((slot) => {
          const sourcePod = slot.source_pod_id != null ? podsById.get(slot.source_pod_id) : undefined;
          const ordinal = advanceOrdinals.get(`${pod.id}:${slot.slot_index}`) ?? 0;
          return (
            <div key={slot.slot_index} className="font-display text-[13px] font-semibold">
              {slot.player_name ? (
                <PlayerName
                  name={slot.player_name}
                  isMe={currentPlayerId !== null && slot.player_id === currentPlayerId}
                />
              ) : (
                <span className="font-mono text-[11px] font-normal tracked text-[var(--color-text-secondary)]">
                  {pendingSlotLabel(slot, sourcePod, ordinal, seedNames)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GauntletRoundCard({
  round,
  allRounds,
  pendingPods,
  podsById,
  advanceOrdinals,
  seedNames,
  rankMap,
  currentPlayerId,
  isOpen,
  onToggle,
}: {
  round: GauntletRound;
  allRounds: GauntletRound[];
  /** This round's not-yet-materialized pods (#528) — already filtered to this round_number. */
  pendingPods: BracketPod[];
  podsById: Map<number, BracketPod>;
  advanceOrdinals: Map<string, number>;
  seedNames?: Map<number, string>;
  rankMap: Map<number, number>;
  currentPlayerId: number | null;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const unsortedRecords = computeGauntletRecords(round.matches);
  const records = rankMap.size > 0
    ? [...unsortedRecords].sort((a, b) =>
        (rankMap.get(a.player_id) ?? Infinity) - (rankMap.get(b.player_id) ?? Infinity))
    : unsortedRecords;
  const allPlayed = allMatchesPlayed(round.matches);
  const isFinalRound = round.is_final_round;

  const podEntries = useMemo(() => buildPodEntries(round.matches, pendingPods), [round.matches, pendingPods]);
  // When every pod in this round shares the same stakes, show it once in the header instead of once
  // per pod below — a round can also mix rules (e.g. one wildcard pod feeding one elimination pod),
  // in which case there's no single label to hoist and each pod keeps its own.
  const podRules = new Set(podEntries.map((g) => g.advance_rule).filter((r) => r != null));
  const roundStakes = !isFinalRound && podRules.size === 1 ? [...podRules][0] : null;

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
    <div id={roundAnchorId(round.round_number)} className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] mb-4 last:mb-0">
      <button
        onClick={onToggle}
        className="lift-row w-full px-4 py-2.5 flex items-center gap-3 border-b border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-left"
        aria-expanded={isOpen}
      >
        <span className="text-[var(--color-text-secondary)] text-[12px] leading-none select-none w-3 shrink-0">
          {isOpen ? '−' : '+'}
        </span>
        <div className="flex items-baseline gap-2.5 flex-1 min-w-0">
          <span className="tracked text-[11px] font-semibold text-[var(--color-text-primary)]">
            Round {round.round_number}
          </span>
          {roundStakes && (
            <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">
              {GAUNTLET_POD_STAKES_LABEL[roundStakes]}
            </span>
          )}
        </div>
      </button>

      {isOpen && (
        <>
          {(() => {
            let gameNumber = 0;
            return podEntries.map((entry, gi) => (
              <div key={entry.kind === 'pending' ? `pod-${entry.pod.id}` : (entry.pod_index ?? `solo-${gi}`)}>
                {!isFinalRound && !roundStakes && entry.advance_rule && (
                  <div className="px-4 py-1.5 font-mono text-[11px] text-[var(--color-text-secondary)] bg-[var(--color-bg-secondary)] border-b border-[var(--color-border-tertiary)]">
                    {GAUNTLET_POD_STAKES_LABEL[entry.advance_rule]}
                  </div>
                )}
                {entry.kind === 'pending' ? (
                  <PendingPodRows
                    pod={entry.pod}
                    podsById={podsById}
                    advanceOrdinals={advanceOrdinals}
                    seedNames={seedNames}
                    currentPlayerId={currentPlayerId}
                  />
                ) : (
                  entry.matches.map((m) => {
                    gameNumber++;
                    const played = isPlayedScore(m.final_score);
                    return (
                      <MatchCard
                        key={m.id}
                        href={`/matches/${m.id}`}
                        map={m.shirts_pick ?? m.picked_map}
                        label={{ type: 'game', gameNumber }}
                        right={played ? { type: 'score', score: m.final_score! } : { type: 'pending' }}
                        shirtsStats={m.shirts_stats}
                        skinsStats={m.skins_stats}
                        shirtsFallback={m.shirts_stats.map((p) => p.player_name).join(' & ') || 'Shirts TBD'}
                        skinsFallback={m.skins_stats.map((p) => p.player_name).join(' & ') || 'Skins TBD'}
                        currentPlayerId={currentPlayerId}
                      />
                    );
                  })
                )}
              </div>
            ));
          })()}

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
                    rankMap.get(r.player_id) === 1;
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
  bracketShape = [],
  seedNames,
  myGamesOnly = false,
  openRounds,
  onToggleRound,
  currentPlayerId,
}: {
  displayRounds: GauntletRound[];
  allRounds: GauntletRound[];
  /** The gauntlet's full pod/slot shape (`getGauntletBracketShape()`) — supplies the placeholder rows
   * this component renders for pods that exist in the bracket but haven't materialized real matches
   * yet (#528). Omitted (or `[]`) renders exactly as before: real matches only. */
  bracketShape?: BracketPod[];
  seedNames?: Map<number, string>;
  /** Mirrors the "My games" toggle `displayRounds` was already filtered by — applied here to
   * `bracketShape`'s pending pods too, so a pod nobody-you've-tracked-yet is in doesn't reappear
   * once the toggle is on. A pod with no resolved slots at all is always shown: there's nothing yet
   * to say it isn't yours. */
  myGamesOnly?: boolean;
  openRounds: Set<number>;
  onToggleRound: (roundNumber: number) => void;
  currentPlayerId: number | null;
}) {
  const rankMap = canonicalGauntletRankMap(allRounds);

  // Pure functions of bracketShape/myGamesOnly/currentPlayerId — memoized so toggling a round
  // open/closed (which re-renders this whole list) doesn't redo them for the entire bracket.
  const podsById = useMemo(() => buildPodsById(bracketShape), [bracketShape]);
  const advanceOrdinals = useMemo(() => computeAdvanceOrdinals(bracketShape), [bracketShape]);
  const pendingPodsByRound = useMemo(() => {
    const byRound = new Map<number, BracketPod[]>();
    for (const pod of bracketShape) {
      if (pod.materialized) continue;
      if (myGamesOnly && currentPlayerId != null && !podMightBeMine(pod, currentPlayerId)) continue;
      const list = byRound.get(pod.round_number) ?? [];
      list.push(pod);
      byRound.set(pod.round_number, list);
    }
    return byRound;
  }, [bracketShape, myGamesOnly, currentPlayerId]);

  if (displayRounds.length === 0) {
    return <EmptyState message="No matches found." />;
  }

  return (
    <div>
      {displayRounds.map((r) => (
        <GauntletRoundCard
          key={r.round_number}
          round={r}
          allRounds={allRounds}
          pendingPods={pendingPodsByRound.get(r.round_number) ?? EMPTY_PODS}
          podsById={podsById}
          advanceOrdinals={advanceOrdinals}
          seedNames={seedNames}
          rankMap={rankMap}
          currentPlayerId={currentPlayerId}
          isOpen={openRounds.has(r.round_number)}
          onToggle={() => onToggleRound(r.round_number)}
        />
      ))}
    </div>
  );
}
