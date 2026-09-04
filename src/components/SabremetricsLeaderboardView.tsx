'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  aggregateRows,
  computeLeagueAverages,
  computePlusStats,
  aggregateWeaponKillStats,
  groupWeaponKillStatsByPlayer,
  aggregateFlairKillStats,
  allWeaponsWithKills,
  resolveWeaponFilterStat,
  groupWeaponAccuracyByPlayer,
  ZERO_WEAPON_CLASS_STAT,
  FAVORITE_WEAPON_FILTER,
  aggregateEconomyStats,
  groupEconomyStatsByPlayer,
  resolveEconomyStat,
  splitStat,
  type AggregatedSab,
  type SabremetricStatRow,
  type MatchKillRow,
  type WeaponKillStat,
  type WeaponFilter,
  type WeaponFilterStat,
  type WeaponClassMatchRow,
  type WeaponClassAggregateStat,
  type PlayerWeaponAccuracy,
  type FlairKillStat,
  type EconomyMatchRow,
  type EconomyTierStat,
  type MatchDamageEventRow,
  type MatchRoundEconomyRow,
} from '@/lib/queries';
import {
  weaponDisplayName, killWeaponCategory, KILL_WEAPON_CATEGORIES, KILL_WEAPON_CATEGORY_LABEL,
  type KillWeaponCategory,
} from '@/lib/parsers/weaponClasses';
import { aggregatePerSideStats, type MatchPickBanInput, type RoundOutcome } from '@/lib/mapSideStats';
import type { RoundHistoryEntry } from '@/lib/types';
import { tabCls } from '@/lib/util';
import EmptyState from './EmptyState';
import StatTileGrid, { type StatTile } from './StatTileGrid';
import { WeaponIcon } from './icons/WeaponIcon';
import { useTabState } from './useTabState';
import { Checkbox } from './SeasonFilter';
import PerSideStatsTable from './PerSideStatsTable';
import RoundEconomyChart from './RoundEconomyChart';

// Side-tint helper (CT/T, not SHIRTS/SKINS) — matches MatchTabView.tsx's own factionClass(),
// duplicated locally per this codebase's existing pattern of small per-file copies (also
// independently defined in DemoUploadModal.tsx and app/matches/[id]/page.tsx).
type Side = 'CT' | 'T' | null;
function factionClass(side: Side): string {
  if (side === 'CT') return 'faction-ct';
  if (side === 'T') return 'faction-t';
  return '';
}

/** One team's slice of a match-page sabremetrics view — filters the aggregate to its
 *  `playerIds` and wraps it in `header` (typically a `<TeamHeader>`) and side tinting. */
export interface TeamGroup {
  key: string;
  playerIds: Set<number>;
  side: Side;
  header?: React.ReactNode;
}

// --- Sorting ---

type SortKey = string;
interface SortState { col: SortKey; asc: boolean }

function useSortState(defaultCol: SortKey): [SortState, (col: SortKey) => void] {
  const [sort, setSort] = useState<SortState>({ col: defaultCol, asc: false });
  const toggle = useCallback(
    (col: SortKey) => setSort((s) => s.col === col ? { col, asc: !s.asc } : { col, asc: false }),
    [],
  );
  return [sort, toggle];
}

function SortableTh({ label, title, sortKey, state, onClick }: {
  label: string; title?: string; sortKey: SortKey; state: SortState; onClick: (key: SortKey) => void;
}) {
  const isActive = state.col === sortKey;
  const arrow = isActive ? (state.asc ? ' ↑' : ' ↓') : '';
  return (
    <th
      title={title}
      onClick={() => onClick(sortKey)}
      className="cursor-pointer select-none px-3 py-2 text-right text-xs font-semibold text-[var(--color-text-secondary)] border-b border-[var(--color-border-primary)] hover:bg-[var(--color-bg-hover)] whitespace-nowrap"
    >
      {label}{arrow}
    </th>
  );
}

// --- Formatting ---

function pct(num: number, den: number): string {
  if (den === 0) return '—';
  return `${Math.round((num / den) * 100)}%`;
}

function fmtNum(v: number, d: number = 0): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(d);
}

function fmtDiff(v: number, d: number = 0): string {
  if (!Number.isFinite(v)) return '—';
  const s = v.toFixed(d);
  return v > 0 ? `+${s}` : s;
}

function plusStyle(val: number): React.CSSProperties {
  const delta = Math.max(-1, Math.min(1, val - 1));
  const pct = Math.round(Math.abs(delta) * 100);
  if (pct === 0) return {};
  const accent = delta > 0 ? 'var(--color-accent-green-fg)' : 'var(--color-accent-red-fg)';
  return { color: `color-mix(in srgb, ${accent} ${pct}%, var(--color-text-primary))` };
}

function OpeningDuels({ wins, losses }: { wins: number; losses: number }) {
  return (
    <span>
      <span className="text-[var(--color-accent-green-fg)]">{wins}</span>
      <span className="text-[var(--color-text-secondary)]">-</span>
      <span className="text-[var(--color-accent-red-fg)]">{losses}</span>
    </span>
  );
}

function PlayerCell({ id, name }: { id: number; name: string }) {
  return (
    <td className="sticky-col px-3 py-2">
      <Link href={`/players/${id}`} className="block">{name}</Link>
    </td>
  );
}

const playerThCls = 'sticky-col px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)] border-b border-[var(--color-border-primary)]';
const tdRight = 'px-3 py-2 text-right tnum';

// --- Impact Stats ---

function ImpactTable({ aggregated, singlePlayer, showHeading = true }: { aggregated: AggregatedSab[]; singlePlayer: boolean; showHeading?: boolean }) {
  const [sort, toggleSort] = useSortState('kast');

  const sorted = useMemo(() => {
    const copy = [...aggregated];
    copy.sort((a, b) => {
      let aVal: number, bVal: number;
      const arp = a.rounds_played || 1;
      const brp = b.rounds_played || 1;
      switch (sort.col) {
        case 'kast': aVal = a.kast_rounds / arp; bVal = b.kast_rounds / brp; break;
        case '2k': aVal = a.two_k_rounds; bVal = b.two_k_rounds; break;
        case 'tk': aVal = a.teamkills; bVal = b.teamkills; break;
        case '1v1': aVal = a.clutch_1v1_wins; bVal = b.clutch_1v1_wins; break;
        case '1v2': aVal = a.clutch_1v2_wins; bVal = b.clutch_1v2_wins; break;
        case '2v1_losses':
          aVal = a.clutch_2v1_attempts - a.clutch_2v1_wins;
          bVal = b.clutch_2v1_attempts - b.clutch_2v1_wins;
          break;
        case 'clutch_pct': {
          const aAttempts = a.clutch_1v1_attempts + a.clutch_1v2_attempts;
          const bAttempts = b.clutch_1v1_attempts + b.clutch_1v2_attempts;
          aVal = aAttempts > 0 ? (a.clutch_1v1_wins + a.clutch_1v2_wins) / aAttempts : 0;
          bVal = bAttempts > 0 ? (b.clutch_1v1_wins + b.clutch_1v2_wins) / bAttempts : 0;
          break;
        }
        default: return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [aggregated, sort]);

  return (
    <div className="my-6">
      {showHeading && <h3 className="text-sm font-semibold mb-3">Impact</h3>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className={singlePlayer ? undefined : 'bg-[var(--color-bg-secondary)]'}>
              {!singlePlayer && <th className={playerThCls}>Player</th>}
              <SortableTh label="KAST" title="Percentage of rounds with a Kill, Assist, Survived, or Traded" sortKey="kast" state={sort} onClick={toggleSort} />
              <SortableTh label="Double Kills" title="Rounds where both opponents were eliminated" sortKey="2k" state={sort} onClick={toggleSort} />
              <SortableTh label="Teamkills" title="Teammates killed" sortKey="tk" state={sort} onClick={toggleSort} />
              <SortableTh label="1v1" title="1v1 clutch wins / attempts" sortKey="1v1" state={sort} onClick={toggleSort} />
              <SortableTh label="1v2" title="1v2 clutch wins / attempts" sortKey="1v2" state={sort} onClick={toggleSort} />
              <SortableTh label="2v1 Losses" title="Rounds this player's side had a 2-vs-1 numbers advantage and still lost, out of all 2v1 advantages (the natural stat behind Choke Score)" sortKey="2v1_losses" state={sort} onClick={toggleSort} />
              <SortableTh label="Clutch %" title="Overall clutch success rate (1v1 + 1v2 wins / attempts)" sortKey="clutch_pct" state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const clutchAttempts = a.clutch_1v1_attempts + a.clutch_1v2_attempts;
              const clutchWins = a.clutch_1v1_wins + a.clutch_1v2_wins;
              return (
                <tr key={a.player_id} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-secondary)]">
                  {!singlePlayer && <PlayerCell id={a.player_id} name={a.player_name} />}
                  <td className={tdRight}>{pct(a.kast_rounds, a.rounds_played)}</td>
                  <td className={tdRight}>{a.two_k_rounds}</td>
                  <td className={tdRight}>{a.teamkills}</td>
                  <td className={tdRight}>{a.clutch_1v1_wins}/{a.clutch_1v1_attempts}</td>
                  <td className={tdRight}>{a.clutch_1v2_wins}/{a.clutch_1v2_attempts}</td>
                  <td className={tdRight}>{a.clutch_2v1_attempts - a.clutch_2v1_wins}/{a.clutch_2v1_attempts}</td>
                  <td className={tdRight}>{pct(clutchWins, clutchAttempts)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Opening Duels ---

function OpeningDuelsTable({ aggregated, singlePlayer, showHeading = true }: { aggregated: AggregatedSab[]; singlePlayer: boolean; showHeading?: boolean }) {
  const [sort, toggleSort] = useSortState('opening_success');

  const sorted = useMemo(() => {
    const copy = [...aggregated];
    copy.sort((a, b) => {
      let aVal: number, bVal: number;
      const arp = a.rounds_played || 1;
      const brp = b.rounds_played || 1;
      switch (sort.col) {
        case 'duels': aVal = a.opening_kills - a.opening_deaths; bVal = b.opening_kills - b.opening_deaths; break;
        case 'opening_pct': aVal = (a.opening_kills + a.opening_deaths) / arp; bVal = (b.opening_kills + b.opening_deaths) / brp; break;
        case 'opening_success': aVal = a.opening_kills / ((a.opening_kills + a.opening_deaths) || 1); bVal = b.opening_kills / ((b.opening_kills + b.opening_deaths) || 1); break;
        default: return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [aggregated, sort]);

  return (
    <div className="my-6">
      {showHeading && <h3 className="text-sm font-semibold mb-3">Opening Duels</h3>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className={singlePlayer ? undefined : 'bg-[var(--color-bg-secondary)]'}>
              {!singlePlayer && <th className={playerThCls}>Player</th>}
              <SortableTh label="Opening Duels" title="First kill and first death of each round (wins-losses)" sortKey="duels" state={sort} onClick={toggleSort} />
              <SortableTh label="Opening %" title="Percentage of rounds where this player took the opening duel" sortKey="opening_pct" state={sort} onClick={toggleSort} />
              <SortableTh label="Opening Success" title="Opening kills / (opening kills + opening deaths)" sortKey="opening_success" state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const totalDuels = a.opening_kills + a.opening_deaths;
              return (
                <tr key={a.player_id} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-secondary)]">
                  {!singlePlayer && <PlayerCell id={a.player_id} name={a.player_name} />}
                  <td className={tdRight}><OpeningDuels wins={a.opening_kills} losses={a.opening_deaths} /></td>
                  <td className={tdRight}>{pct(totalDuels, a.rounds_played)}</td>
                  <td className={tdRight}>{pct(a.opening_kills, totalDuels)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Mechanics Stats (raw, ungated — see docs/calculations.md) ---

function MechanicsTable({ aggregated, singlePlayer, showHeading = true }: { aggregated: AggregatedSab[]; singlePlayer: boolean; showHeading?: boolean }) {
  const [sort, toggleSort] = useSortState('acc');

  const sorted = useMemo(() => {
    const copy = [...aggregated];
    copy.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sort.col) {
        case 'shots_fired': aVal = a.shots_fired; bVal = b.shots_fired; break;
        case 'acc': aVal = a.shots_hit / (a.shots_fired || 1); bVal = b.shots_hit / (b.shots_fired || 1); break;
        case 'head_acc': aVal = a.headshot_hits_no_awp / (a.shots_hit_no_awp || 1); bVal = b.headshot_hits_no_awp / (b.shots_hit_no_awp || 1); break;
        case 'cstrafe':
          aVal = a.counter_strafe_good_shots / (a.counter_strafe_shots || 1);
          bVal = b.counter_strafe_good_shots / (b.counter_strafe_shots || 1);
          break;
        case 'spray':
          aVal = a.spray_shots_hit / (a.spray_shots_fired || 1);
          bVal = b.spray_shots_hit / (b.spray_shots_fired || 1);
          break;
        case 'dropped_reload':
          aVal = a.rounds_dropped_on_reload_total / (a.reloads_total || 1);
          bVal = b.rounds_dropped_on_reload_total / (b.reloads_total || 1);
          break;
        default: return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [aggregated, sort]);

  return (
    <div className="my-6">
      {showHeading && <h3 className="text-sm font-semibold mb-3">Mechanics</h3>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className={singlePlayer ? undefined : 'bg-[var(--color-bg-secondary)]'}>
              {!singlePlayer && <th className={playerThCls}>Player</th>}
              <SortableTh label="Shots Fired" title="Shots fired (guns only, not gated on enemy visibility)" sortKey="shots_fired" state={sort} onClick={toggleSort} />
              <SortableTh label="Accuracy" title="Shots that hit an enemy / shots fired (guns only, not gated on enemy visibility)" sortKey="acc" state={sort} onClick={toggleSort} />
              <SortableTh label="Head Accuracy" title="Hits landing on the head / total hits, excluding AWP shots (matches Leetify's Headshot Accuracy)" sortKey="head_acc" state={sort} onClick={toggleSort} />
              <SortableTh label="Counter-Strafe %" title="Rifle shots fired at under 34% of max speed / all standing rifle shots (crouched shots excluded)" sortKey="cstrafe" state={sort} onClick={toggleSort} />
              <SortableTh label="Spray Accuracy" title="Hits / shots within sequences of 3+ consecutive rifle shots" sortKey="spray" state={sort} onClick={toggleSort} />
              <SortableTh label="Rounds Dropped/Reload" title="Bullets still in the magazine (wasted) when reloading, averaged across every reload including clean ones" sortKey="dropped_reload" state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => (
              <tr key={a.player_id} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-secondary)]">
                {!singlePlayer && <PlayerCell id={a.player_id} name={a.player_name} />}
                <td className={tdRight}>{a.shots_fired}</td>
                <td className={tdRight}>{pct(a.shots_hit, a.shots_fired)}</td>
                <td className={tdRight}>{pct(a.headshot_hits_no_awp, a.shots_hit_no_awp)}</td>
                <td className={tdRight}>{pct(a.counter_strafe_good_shots, a.counter_strafe_shots)}</td>
                <td className={tdRight}>{pct(a.spray_shots_hit, a.spray_shots_fired)}</td>
                <td className={tdRight}>{fmtNum(a.rounds_dropped_on_reload_total / (a.reloads_total || 1), 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// --- Weapon Stats (#452, #474) ---
//
// Unlike every table above, per-player weapon breakdown isn't part of `AggregatedSab`/`SabFields`
// — it's derived from raw `match_kills` rows (`aggregateWeaponKillStats()`/`resolveWeaponFilterStat()`,
// `src/lib/queries/kills.ts`) instead. `kills` may be empty (no demo reparsed since #452 added
// this table) — the row/tile values just come back honestly zeroed rather than hiding the tab.
//
// The table shows one filter selection's stats per player at a time, picked by `selectedFilter` —
// each player's own favorite weapon (`null`), one weapon applied to every row, or a whole category
// (guns/melee/utility/other) rolled up across every weapon in it — rather than each player's
// favorite label next to a *different* weapon's (all-weapons-combined) totals, which read as
// mismatched (e.g. "Favorite: AK-47 (20)" next to a 52-kill total across every weapon). Every row
// also carries `player_match_weapon_stats`' accuracy/shots/damage/rounds breakdown for that same
// selection (`WeaponFilterStat.accuracy`, resolved by `resolveWeaponFilterStat()` itself — kills.ts)
// — `null` only when the selection has no such concept at all (melee/utility/other), not merely
// because the count is zero, so the two ideas never get confused in the UI.

// `<select>` only ever accepts a string value, so the `WeaponFilter` union is encoded/decoded to
// one right here at the DOM boundary — every other consumer of a `WeaponFilter` (kills.ts,
// WeaponsTable, buildWeaponTiles) works with the real union, never a string.
const FAVORITE_OPTION_VALUE = 'favorite';
const CATEGORY_OPTION_PREFIX = 'category:';

function filterToOptionValue(filter: WeaponFilter): string {
  if (filter.kind === 'favorite') return FAVORITE_OPTION_VALUE;
  if (filter.kind === 'category') return `${CATEGORY_OPTION_PREFIX}${filter.category}`;
  return filter.weapon;
}

function optionValueToFilter(value: string): WeaponFilter {
  if (value === FAVORITE_OPTION_VALUE) return FAVORITE_WEAPON_FILTER;
  if (value.startsWith(CATEGORY_OPTION_PREFIX)) {
    return { kind: 'category', category: value.slice(CATEGORY_OPTION_PREFIX.length) as KillWeaponCategory };
  }
  return { kind: 'weapon', weapon: value };
}

/** The weapon-picker shared by the multi-player table and the single-player tile view — one
 *  control per Weapons sub-tab render, not per team-group table, so a match page with two teams
 *  shows one dropdown that both tables honor. Lists whole categories (#474's "options for the
 *  categories" ask) ahead of individual weapons, both with their display names rather than raw
 *  backend classnames — `allWeaponsWithKills()` already groups every knife/bayonet skin into one
 *  `knife` option. */
// The filter dropdown never gives `melee` its own <optgroup> — every knife/bayonet skin already
// collapses to the single `knife` key (`weaponGroupKey()`), so a "Knives" group would only ever
// contain one weapon, making "All Knives" and "Knife" identical selections sitting right on top of
// each other. Its one weapon is folded into "Other" for display instead (below). This is purely a
// dropdown-grouping choice — the underlying `melee` category itself is untouched, and still backs
// `aggregateKillCategoryStats()`/the Flair tab's Knife stat exactly as before.
const DROPDOWN_CATEGORIES = KILL_WEAPON_CATEGORIES.filter((c) => c !== 'melee');

// `other` (world/fall-damage and bomb-detonation deaths) never has a real player attacker — see
// `killWeaponCategory()` — so "All Other" would always resolve zero Kills, which reads as broken
// rather than correct: a Deaths-only stat forced through a Kills-shaped filter. Hidden as a
// selectable category — its uncredited-death counts have their own dedicated display instead
// (`FlairTable`'s Fall Deaths/C4 Deaths columns, `aggregateFlairKillStats()` in queries/kills.ts);
// `other`'s one folded-in weapon (`Knife` — see above) still shows if the player has any.
const HIDDEN_CATEGORY_FILTERS = new Set<KillWeaponCategory>(['other']);

function WeaponFilterSelect({ kills, value, onChange }: {
  kills: MatchKillRow[]; value: WeaponFilter; onChange: (filter: WeaponFilter) => void;
}) {
  // One <optgroup> per category (its display name as the bold, unselectable group label), with an
  // "All <category>" <option> right under it standing in for "the title is selectable" — a native
  // <select> can't make an <optgroup> label itself clickable, and repeating the label verbatim as
  // that first option read as a duplicate rather than a selection, so it's worded to read as its
  // own option instead. Every category gets a group regardless of whether any of its weapons have
  // a kill in scope yet, matching the category filter's existing all-or-nothing availability; only
  // the individual-weapon rows underneath are scoped to `allWeaponsWithKills()`.
  const weaponsByCategory = useMemo(() => {
    const map = new Map<KillWeaponCategory, string[]>();
    for (const w of allWeaponsWithKills(kills)) {
      const category = killWeaponCategory(w);
      // See DROPDOWN_CATEGORIES above — melee's one weapon displays under "Other" instead of its
      // own group.
      const displayCategory = category === 'melee' ? 'other' : category;
      let list = map.get(displayCategory);
      if (!list) {
        list = [];
        map.set(displayCategory, list);
      }
      list.push(w);
    }
    return map;
  }, [kills]);

  return (
    <div className="flex items-center gap-2">
      <span className="tracked text-[10px] font-semibold text-[var(--color-text-secondary)]">Weapon</span>
      <select
        value={filterToOptionValue(value)}
        onChange={(e) => onChange(optionValueToFilter(e.target.value))}
        className="tracked text-[11px] font-semibold border border-[var(--color-border-primary)] px-2.5 py-1 bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] cursor-pointer hover:bg-[var(--color-bg-secondary)] transition-colors"
      >
        <option value={FAVORITE_OPTION_VALUE}>Favorite</option>
        {DROPDOWN_CATEGORIES.map((c) => {
          const weapons = weaponsByCategory.get(c) ?? [];
          const showCategoryOption = !HIDDEN_CATEGORY_FILTERS.has(c);
          if (!showCategoryOption && weapons.length === 0) return null; // nothing left to show
          return (
            <optgroup key={c} label={KILL_WEAPON_CATEGORY_LABEL[c]}>
              {showCategoryOption && (
                <option value={`${CATEGORY_OPTION_PREFIX}${c}`}>All {KILL_WEAPON_CATEGORY_LABEL[c]}</option>
              )}
              {weapons.map((w) => <option key={w} value={w}>{weaponDisplayName(w)}</option>)}
            </optgroup>
          );
        })}
      </select>
    </div>
  );
}

type PlayerWeaponRow = WeaponFilterStat & { player_id: number; player_name: string };

function resolvePlayerWeaponRow(
  playerId: number,
  playerName: string,
  weaponStatsByPlayer: Map<number, WeaponKillStat[]>,
  selectedFilter: WeaponFilter,
  accuracyByPlayer: Map<number, PlayerWeaponAccuracy>,
): PlayerWeaponRow {
  const resolved = resolveWeaponFilterStat(weaponStatsByPlayer.get(playerId) ?? [], selectedFilter, accuracyByPlayer.get(playerId));
  return { player_id: playerId, player_name: playerName, ...resolved };
}

/** Icon + display name — shared by the WeaponsTable column and the single-player Weapon tile
 *  (`buildWeaponTiles()`); kills live in their own "Kills With" column/tile next to it. No icon
 *  when `weapon` is null (a whole category is selected, or there's no favorite to show) — there's
 *  no single weapon to draw one for. */
function WeaponLabel({ weapon, label }: { weapon: string | null; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {weapon && <WeaponIcon weapon={weapon} size={13} />}
      {label}
    </span>
  );
}

/** `r.accuracy`'s fields, defaulted to zero for a sort comparator — `null` (no accuracy concept
 *  for this row's weapon/category) sorts identically to an all-zero real accuracy stat, which is
 *  the right behavior (nothing to rank it by either way). */
function accuracyOf(r: PlayerWeaponRow): WeaponClassAggregateStat {
  return r.accuracy ?? ZERO_WEAPON_CLASS_STAT;
}

function WeaponsTable({ aggregated, kills, weaponClassStats, selectedFilter, singlePlayer, showHeading = true }: {
  aggregated: AggregatedSab[];
  kills: MatchKillRow[];
  weaponClassStats: WeaponClassMatchRow[];
  selectedFilter: WeaponFilter;
  singlePlayer: boolean;
  showHeading?: boolean;
}) {
  const [sort, toggleSort] = useSortState('kills');

  // One grouping pass over `weaponClassStats`, not a per-player scan — see
  // `groupWeaponAccuracyByPlayer()`'s own reasoning (queries/weaponStats.ts).
  const accuracyByPlayer = useMemo(() => groupWeaponAccuracyByPlayer(weaponClassStats), [weaponClassStats]);

  // One grouping pass over `kills`, not a per-player rescan — see `groupWeaponKillStatsByPlayer()`'s
  // own reasoning (queries/kills.ts, #502).
  const weaponStatsByPlayer = useMemo(() => groupWeaponKillStatsByPlayer(kills), [kills]);

  const rows = useMemo(
    () => aggregated.map((a) => resolvePlayerWeaponRow(a.player_id, a.player_name, weaponStatsByPlayer, selectedFilter, accuracyByPlayer)),
    [aggregated, weaponStatsByPlayer, selectedFilter, accuracyByPlayer],
  );

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sort.col) {
        case 'kills': aVal = a.kills; bVal = b.kills; break;
        case 'hs': aVal = a.headshotKills / (a.kills || 1); bVal = b.headshotKills / (b.kills || 1); break;
        case 'ns': aVal = a.noscopeKills; bVal = b.noscopeKills; break;
        case 'wb': aVal = a.wallbangKills; bVal = b.wallbangKills; break;
        case 'blind': aVal = a.blindKills; bVal = b.blindKills; break;
        case 'midair': aVal = a.midairKills; bVal = b.midairKills; break;
        case 'deaths': aVal = a.deaths; bVal = b.deaths; break;
        case 'shots_fired': aVal = accuracyOf(a).shots_fired; bVal = accuracyOf(b).shots_fired; break;
        case 'acc': aVal = accuracyOf(a).shots_hit / (accuracyOf(a).shots_fired || 1); bVal = accuracyOf(b).shots_hit / (accuracyOf(b).shots_fired || 1); break;
        case 'head_acc': aVal = accuracyOf(a).headshot_hits / (accuracyOf(a).shots_hit || 1); bVal = accuracyOf(b).headshot_hits / (accuracyOf(b).shots_hit || 1); break;
        case 'dmg_round': aVal = accuracyOf(a).damage_dealt / (accuracyOf(a).rounds_played || 1); bVal = accuracyOf(b).damage_dealt / (accuracyOf(b).rounds_played || 1); break;
        case 'rounds': aVal = accuracyOf(a).rounds_played; bVal = accuracyOf(b).rounds_played; break;
        default: return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [rows, sort]);

  const weaponColTitle = selectedFilter.kind === 'favorite'
    ? "The weapon with this player's most credited kills"
    : selectedFilter.kind === 'category'
      ? `Stats are for every ${KILL_WEAPON_CATEGORY_LABEL[selectedFilter.category].toLowerCase()} kill combined`
      : `Stats are for ${weaponDisplayName(selectedFilter.weapon)} specifically, whether or not it's this player's favorite`;

  return (
    <div className="my-6">
      {showHeading && <h3 className="text-sm font-semibold mb-3">Weapons</h3>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className={singlePlayer ? undefined : 'bg-[var(--color-bg-secondary)]'}>
              {!singlePlayer && <th className={playerThCls}>Player</th>}
              <th className="px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)] border-b border-[var(--color-border-primary)]" title={weaponColTitle}>Weapon</th>
              <SortableTh label="Kills With" title="Credited kills with this weapon (excludes self-kills and teamkills)" sortKey="kills" state={sort} onClick={toggleSort} />
              <SortableTh label="HS% With" title="Headshot kills / kills with this weapon" sortKey="hs" state={sort} onClick={toggleSort} />
              <SortableTh label="NS With" title="No-scope kills with this weapon" sortKey="ns" state={sort} onClick={toggleSort} />
              <SortableTh label="WB With" title="Wallbang kills with this weapon" sortKey="wb" state={sort} onClick={toggleSort} />
              <SortableTh label="Blind With" title="Kills scored while the attacker was flashed, with this weapon" sortKey="blind" state={sort} onClick={toggleSort} />
              <SortableTh label="Midair With" title="Mid-air kills (attacker was airborne) with this weapon" sortKey="midair" state={sort} onClick={toggleSort} />
              <SortableTh label="Deaths To" title="Deaths to this weapon" sortKey="deaths" state={sort} onClick={toggleSort} />
              <SortableTh label="Shots Fired" title="Shots fired with this weapon/category (guns only — '—' for a knife, grenade, etc.)" sortKey="shots_fired" state={sort} onClick={toggleSort} />
              <SortableTh label="Accuracy" title="Shots that hit an enemy / shots fired" sortKey="acc" state={sort} onClick={toggleSort} />
              <SortableTh label="Head Accuracy" title="Hits landing on the head / total hits" sortKey="head_acc" state={sort} onClick={toggleSort} />
              <SortableTh label="Damage/Round" title="Damage dealt / rounds played with this weapon/category" sortKey="dmg_round" state={sort} onClick={toggleSort} />
              <SortableTh label="Rounds" title="Rounds this player used this weapon/category in at least once" sortKey="rounds" state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.player_id} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-secondary)]">
                {!singlePlayer && <PlayerCell id={r.player_id} name={r.player_name} />}
                <td className="px-3 py-2 text-left"><WeaponLabel weapon={r.weapon} label={r.label} /></td>
                <td className={tdRight}>{r.kills}</td>
                <td className={tdRight}>{pct(r.headshotKills, r.kills)}</td>
                <td className={tdRight}>{r.noscopeKills}</td>
                <td className={tdRight}>{r.wallbangKills}</td>
                <td className={tdRight}>{r.blindKills}</td>
                <td className={tdRight}>{r.midairKills}</td>
                <td className={tdRight}>{r.deaths}</td>
                <td className={tdRight}>{r.accuracy ? r.accuracy.shots_fired : '—'}</td>
                <td className={tdRight}>{r.accuracy ? pct(r.accuracy.shots_hit, r.accuracy.shots_fired) : '—'}</td>
                <td className={tdRight}>{r.accuracy ? pct(r.accuracy.headshot_hits, r.accuracy.shots_hit) : '—'}</td>
                <td className={tdRight}>{r.accuracy ? fmtNum(r.accuracy.rounds_played > 0 ? r.accuracy.damage_dealt / r.accuracy.rounds_played : 0, 1) : '—'}</td>
                <td className={tdRight}>{r.accuracy ? r.accuracy.rounds_played : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Economy (#481) ---
//
// Same per-player breakdown pattern as Weapons above, one economy tier's stats per player at a
// time, picked by `selectedTier` — but sourced from `player_match_economy_stats`
// (`aggregateEconomyStats()`/`resolveEconomyStat()`, `src/lib/queries/weaponStats.ts`) instead of
// `match_kills`, since a round's economy classification isn't itself a kill event. The three tiers
// are a fixed, game-defined set (unlike weapons, which vary player to player), so the picker's
// options are a static list rather than derived from data. Unlike Weapons' favorite-or-specific
// picker, there's no "most played" default option here: with only three buckets and full-buy
// rounds dominating most matches, "most played" would resolve to full-buy for nearly every player,
// making it a redundant alias for an explicit selection rather than a useful default — so the
// picker always names one tier explicitly, and the table/tiles don't repeat that choice back as
// their own "Tier" column/tile.

const ECONOMY_TIERS: { type: string; label: string }[] = [
  { type: 'eco', label: 'Eco' },
  { type: 'force_buy', label: 'Force Buy' },
  { type: 'full_buy', label: 'Full Buy' },
];

const ECONOMY_TIER_OPTIONS = ECONOMY_TIERS.map((t) => ({ value: t.type, label: t.label }));

/** The economy-tier picker shared by the multi-player table and the single-player tile view — a
 *  plain `<select>` over the fixed tier list, always one explicit tier (no "favorite" sentinel;
 *  see the section comment above). */
function EconomyFilterSelect({ value, onChange }: {
  value: string; onChange: (economyType: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="tracked text-[10px] font-semibold text-[var(--color-text-secondary)]">Economy Tier</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="tracked text-[11px] font-semibold border border-[var(--color-border-primary)] px-2.5 py-1 bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] cursor-pointer hover:bg-[var(--color-bg-secondary)] transition-colors"
      >
        {ECONOMY_TIER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function economyTierLabel(economyType: string): string {
  return ECONOMY_TIERS.find((t) => t.type === economyType)?.label ?? economyType;
}

interface PlayerEconomyRow extends EconomyTierStat {
  player_id: number;
  player_name: string;
}

function resolvePlayerEconomyRow(
  playerId: number,
  playerName: string,
  economyStatsByPlayer: Map<number, EconomyTierStat[]>,
  selectedTier: string,
): PlayerEconomyRow {
  const resolved = resolveEconomyStat(economyStatsByPlayer.get(playerId) ?? [], selectedTier);
  return { player_id: playerId, player_name: playerName, ...resolved };
}

function EconomyTable({ aggregated, economyRows, selectedTier, singlePlayer, showHeading = true }: {
  aggregated: AggregatedSab[];
  economyRows: EconomyMatchRow[];
  selectedTier: string;
  singlePlayer: boolean;
  showHeading?: boolean;
}) {
  const [sort, toggleSort] = useSortState('rounds_played');

  // One grouping pass over `economyRows`, not a per-player rescan — see
  // `groupEconomyStatsByPlayer()`'s own reasoning (queries/weaponStats.ts, #502).
  const economyStatsByPlayer = useMemo(() => groupEconomyStatsByPlayer(economyRows), [economyRows]);

  const rows = useMemo(
    () => aggregated.map((a) => resolvePlayerEconomyRow(a.player_id, a.player_name, economyStatsByPlayer, selectedTier)),
    [aggregated, economyStatsByPlayer, selectedTier],
  );

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sort.col) {
        case 'rounds_played': aVal = a.rounds_played; bVal = b.rounds_played; break;
        case 'rounds_won': aVal = a.rounds_won; bVal = b.rounds_won; break;
        case 'shots_fired': aVal = a.shots_fired; bVal = b.shots_fired; break;
        case 'acc': aVal = a.shots_hit / (a.shots_fired || 1); bVal = b.shots_hit / (b.shots_fired || 1); break;
        case 'hs': aVal = a.headshot_hits / (a.shots_hit || 1); bVal = b.headshot_hits / (b.shots_hit || 1); break;
        case 'dpr': aVal = a.damage_dealt / (a.rounds_played || 1); bVal = b.damage_dealt / (b.rounds_played || 1); break;
        default: return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [rows, sort]);

  const tierLabel = economyTierLabel(selectedTier);

  return (
    <div className="my-6">
      {showHeading && <h3 className="text-sm font-semibold mb-3">Economy</h3>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className={singlePlayer ? undefined : 'bg-[var(--color-bg-secondary)]'}>
              {!singlePlayer && <th className={playerThCls}>Player</th>}
              <SortableTh label="Rounds Played" title={`Rounds played at ${tierLabel} — seeded from the round's own eco/force/full classification, whether or not this player fired a shot in it`} sortKey="rounds_played" state={sort} onClick={toggleSort} />
              <SortableTh label="W-L" title={`Rounds won vs. lost at ${tierLabel}`} sortKey="rounds_won" state={sort} onClick={toggleSort} />
              <SortableTh label="Shots Fired" title={`Shots fired (guns only) in rounds at ${tierLabel}`} sortKey="shots_fired" state={sort} onClick={toggleSort} />
              <SortableTh label="Accuracy" title={`Shots that hit an enemy / shots fired, in rounds at ${tierLabel}`} sortKey="acc" state={sort} onClick={toggleSort} />
              <SortableTh label="Headshot %" title={`Headshot hits / hits, in rounds at ${tierLabel}`} sortKey="hs" state={sort} onClick={toggleSort} />
              <SortableTh label="Damage/Round" title={`Damage dealt per round played at ${tierLabel}`} sortKey="dpr" state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.player_id} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-secondary)]">
                {!singlePlayer && <PlayerCell id={r.player_id} name={r.player_name} />}
                <td className={tdRight}>{r.rounds_played}</td>
                <td className={tdRight}>{r.rounds_won}-{r.rounds_played - r.rounds_won}</td>
                <td className={tdRight}>{r.shots_fired}</td>
                <td className={tdRight}>{pct(r.shots_hit, r.shots_fired)}</td>
                <td className={tdRight}>{pct(r.headshot_hits, r.shots_hit)}</td>
                <td className={tdRight}>{fmtNum(r.damage_dealt / (r.rounds_played || 1), 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Flair ---
//
// Off-meta kill counts worth showing off on their own — no-scope/wallbang/blind/knife kills,
// totaled across every weapon (`aggregateFlairKillStats()`) rather than broken out per-weapon
// like the Weapons sub-tab above. Also home to the two uncredited-death counts (fall damage, C4)
// that the Weapons sub-tab's Kills-shaped filter can't show (#498) — `HIDDEN_CATEGORY_FILTERS`
// above has the full story on why `other` is hidden from that filter.

interface PlayerFlairRow {
  player_id: number;
  player_name: string;
  flair: FlairKillStat;
}

function FlairTable({ aggregated, kills, singlePlayer, showHeading = true }: {
  aggregated: AggregatedSab[];
  kills: MatchKillRow[];
  singlePlayer: boolean;
  showHeading?: boolean;
}) {
  const [sort, toggleSort] = useSortState('noscope');

  const rows = useMemo<PlayerFlairRow[]>(
    () => aggregated.map((a) => ({
      player_id: a.player_id,
      player_name: a.player_name,
      flair: aggregateFlairKillStats(kills, a.player_id),
    })),
    [aggregated, kills],
  );

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sort.col) {
        case 'noscope': aVal = a.flair.noscopeKills; bVal = b.flair.noscopeKills; break;
        case 'wallbang': aVal = a.flair.wallbangKills; bVal = b.flair.wallbangKills; break;
        case 'blind': aVal = a.flair.blindKills; bVal = b.flair.blindKills; break;
        case 'midair': aVal = a.flair.midairKills; bVal = b.flair.midairKills; break;
        case 'knife': aVal = a.flair.knifeKills; bVal = b.flair.knifeKills; break;
        case 'fall_deaths': aVal = a.flair.fallDamageDeaths; bVal = b.flair.fallDamageDeaths; break;
        case 'c4_deaths': aVal = a.flair.c4Deaths; bVal = b.flair.c4Deaths; break;
        default: return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [rows, sort]);

  return (
    <div className="my-6">
      {showHeading && <h3 className="text-sm font-semibold mb-3">Flair</h3>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className={singlePlayer ? undefined : 'bg-[var(--color-bg-secondary)]'}>
              {!singlePlayer && <th className={playerThCls}>Player</th>}
              <SortableTh label="No-scope" title="No-scope kills, across every weapon" sortKey="noscope" state={sort} onClick={toggleSort} />
              <SortableTh label="Wallbang" title="Wallbang kills (bullet penetrated a surface), across every weapon" sortKey="wallbang" state={sort} onClick={toggleSort} />
              <SortableTh label="Blind" title="Kills scored while the attacker was flashed, across every weapon" sortKey="blind" state={sort} onClick={toggleSort} />
              <SortableTh label="Midair" title="Mid-air kills (attacker was airborne), across every weapon" sortKey="midair" state={sort} onClick={toggleSort} />
              <SortableTh label="Knife" title="Knife kills" sortKey="knife" state={sort} onClick={toggleSort} />
              <SortableTh label="Fall Deaths" title="Deaths to fall damage or other environmental causes — never has a real attacker, so this is a death count, not a kill count" sortKey="fall_deaths" state={sort} onClick={toggleSort} />
              <SortableTh label="C4 Deaths" title="Deaths to bomb detonation — never has a real attacker, so this is a death count, not a kill count" sortKey="c4_deaths" state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.player_id} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-secondary)]">
                {!singlePlayer && <PlayerCell id={r.player_id} name={r.player_name} />}
                <td className={tdRight}>{r.flair.noscopeKills}</td>
                <td className={tdRight}>{r.flair.wallbangKills}</td>
                <td className={tdRight}>{r.flair.blindKills}</td>
                <td className={tdRight}>{r.flair.midairKills}</td>
                <td className={tdRight}>{r.flair.knifeKills}</td>
                <td className={tdRight}>{r.flair.fallDamageDeaths}</td>
                <td className={tdRight}>{r.flair.c4Deaths}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WeaponBar({ weapon, kills, maxKills }: { weapon: string; kills: number; maxKills: number }) {
  const pctWidth = maxKills > 0 ? Math.max(0, Math.min(100, (kills / maxKills) * 100)) : 0;
  return (
    <div className="grid grid-cols-[100px_1fr_40px] items-center gap-2.5 py-1.5">
      <span className="tracked text-[9px] text-[var(--color-text-secondary)] inline-flex items-center gap-1.5">
        <WeaponIcon weapon={weapon} size={11} />
        {weaponDisplayName(weapon)}
      </span>
      <span className="block h-[6px] w-full bg-[rgba(255,255,255,0.08)]">
        <span className="block h-full bg-[var(--color-site-accent)]" style={{ width: `${pctWidth}%` }} />
      </span>
      <span className="font-mono text-[10px] text-right text-[var(--color-text-primary)]">{kills}</span>
    </div>
  );
}

// --- Trade Stats ---

function TradesTable({ aggregated, singlePlayer, showHeading = true }: { aggregated: AggregatedSab[]; singlePlayer: boolean; showHeading?: boolean }) {
  const [sort, toggleSort] = useSortState('trade_kill_pct');

  const sorted = useMemo(() => {
    const copy = [...aggregated];
    copy.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sort.col) {
        case 'trade_kill_opp': aVal = a.trade_kill_opportunities; bVal = b.trade_kill_opportunities; break;
        case 'trade_kill_att': aVal = a.trade_kill_attempts; bVal = b.trade_kill_attempts; break;
        case 'trade_kill_succ': aVal = a.trade_kill_successes; bVal = b.trade_kill_successes; break;
        case 'trade_kill_pct':
          aVal = a.trade_kill_successes / (a.trade_kill_attempts || 1);
          bVal = b.trade_kill_successes / (b.trade_kill_attempts || 1);
          break;
        case 'traded_death_opp': aVal = a.traded_death_opportunities; bVal = b.traded_death_opportunities; break;
        case 'traded_death_att': aVal = a.traded_death_attempts; bVal = b.traded_death_attempts; break;
        case 'traded_death_succ': aVal = a.traded_death_successes; bVal = b.traded_death_successes; break;
        case 'traded_death_pct':
          aVal = a.traded_death_successes / (a.traded_death_attempts || 1);
          bVal = b.traded_death_successes / (b.traded_death_attempts || 1);
          break;
        default: return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [aggregated, sort]);

  return (
    <div className="my-6">
      {showHeading && <h3 className="text-sm font-semibold mb-3">Trades</h3>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className={singlePlayer ? undefined : 'bg-[var(--color-bg-secondary)]'}>
              {!singlePlayer && <th className={playerThCls}>Player</th>}
              <SortableTh label="Trade Kill Opps" title="Trade kill opportunities: times a teammate died while this player was still alive (the chance to trade existed)" sortKey="trade_kill_opp" state={sort} onClick={toggleSort} />
              <SortableTh label="Trade Kill Attempts" title="Trade kill attempts: opportunities where this player damaged the killer within the trade window" sortKey="trade_kill_att" state={sort} onClick={toggleSort} />
              <SortableTh label="Trade Kills" title="Trade kill successes: opportunities where this player killed the killer within the trade window" sortKey="trade_kill_succ" state={sort} onClick={toggleSort} />
              <SortableTh label="Trade Kill %" title="Trade kill successes / attempts" sortKey="trade_kill_pct" state={sort} onClick={toggleSort} />
              <SortableTh label="Traded Death Opps" title="Traded death opportunities: times this player died while at least one teammate was still alive (someone had the chance to trade them)" sortKey="traded_death_opp" state={sort} onClick={toggleSort} />
              <SortableTh label="Traded Death Attempts" title="Traded death attempts: opportunities where a teammate damaged the killer within the trade window" sortKey="traded_death_att" state={sort} onClick={toggleSort} />
              <SortableTh label="Traded Deaths" title="Traded death successes: opportunities where a teammate killed the killer within the trade window" sortKey="traded_death_succ" state={sort} onClick={toggleSort} />
              <SortableTh label="Traded Death %" title="Traded death successes / attempts" sortKey="traded_death_pct" state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => (
              <tr key={a.player_id} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-secondary)]">
                {!singlePlayer && <PlayerCell id={a.player_id} name={a.player_name} />}
                <td className={tdRight}>{a.trade_kill_opportunities}</td>
                <td className={tdRight}>{a.trade_kill_attempts}</td>
                <td className={tdRight}>{a.trade_kill_successes}</td>
                <td className={tdRight}>{pct(a.trade_kill_successes, a.trade_kill_attempts)}</td>
                <td className={tdRight}>{a.traded_death_opportunities}</td>
                <td className={tdRight}>{a.traded_death_attempts}</td>
                <td className={tdRight}>{a.traded_death_successes}</td>
                <td className={tdRight}>{pct(a.traded_death_successes, a.traded_death_attempts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Utility Stats ---

function UtilityTable({ aggregated, singlePlayer, showHeading = true }: { aggregated: AggregatedSab[]; singlePlayer: boolean; showHeading?: boolean }) {
  const [sort, toggleSort] = useSortState('ud');

  const sorted = useMemo(() => {
    const copy = [...aggregated];
    copy.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sort.col) {
        case 'ud': aVal = a.utility_damage; bVal = b.utility_damage; break;
        case 'tf': aVal = a.teamflash_duration; bVal = b.teamflash_duration; break;
        case 'fa': aVal = a.flash_assists; bVal = b.flash_assists; break;
        case 'ef': aVal = a.enemies_flashed; bVal = b.enemies_flashed; break;
        case 'pl': aVal = a.plants; bVal = b.plants; break;
        case 'df': aVal = a.defuses; bVal = b.defuses; break;
        case 'fltk': aVal = a.flashes_leading_to_kill; bVal = b.flashes_leading_to_kill; break;
        case 'ef_flash':
          aVal = a.enemies_flashed / (a.flashes_thrown || 1);
          bVal = b.enemies_flashed / (b.flashes_thrown || 1);
          break;
        case 'blind_flash':
          aVal = a.blind_duration_max_sum / (a.effective_flashes || 1);
          bVal = b.blind_duration_max_sum / (b.effective_flashes || 1);
          break;
        case 'bdd': aVal = a.blind_duration_dealt; bVal = b.blind_duration_dealt; break;
        case 'he_thrown': aVal = a.he_thrown; bVal = b.he_thrown; break;
        case 'he_dmg': aVal = a.he_damage; bVal = b.he_damage; break;
        case 'he_dmg_throw':
          aVal = a.he_damage / (a.he_thrown || 1);
          bVal = b.he_damage / (b.he_thrown || 1);
          break;
        case 'smoke_block':
          aVal = a.smokes_blocking_push / (a.ct_smokes_thrown || 1);
          bVal = b.smokes_blocking_push / (b.ct_smokes_thrown || 1);
          break;
        case 'unused_util':
          aVal = a.unused_util_value_on_death_total / (a.deaths || 1);
          bVal = b.unused_util_value_on_death_total / (b.deaths || 1);
          break;
        default: return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [aggregated, sort]);

  return (
    <div className="my-6">
      {showHeading && <h3 className="text-sm font-semibold mb-3">Utility</h3>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className={singlePlayer ? undefined : 'bg-[var(--color-bg-secondary)]'}>
              {!singlePlayer && <th className={playerThCls}>Player</th>}
              <SortableTh label="Utility Damage" title="Damage dealt with grenades (HE, molotov, incendiary) — sourced from CS2's own m_iUtilityDamage engine accumulator, which combines both" sortKey="ud" state={sort} onClick={toggleSort} />
              <SortableTh label="Teamflash Duration" title="Total seconds spent blinding teammates — subtracted from Utility Score" sortKey="tf" state={sort} onClick={toggleSort} />
              <SortableTh label="Flash Assists" title="Kills by a teammate on an enemy you flashbanged" sortKey="fa" state={sort} onClick={toggleSort} />
              <SortableTh label="Flashes → Kill" title="Enemies killed by anyone (including you) while still blinded by your flash — Leetify's flash-effectiveness definition" sortKey="fltk" state={sort} onClick={toggleSort} />
              <SortableTh label="Enemies Flashed" title="Enemy players blinded by your flashbangs" sortKey="ef" state={sort} onClick={toggleSort} />
              <SortableTh label="Enemies Flashed/Flash" title="Enemies flashed (1.1s+) per flashbang thrown" sortKey="ef_flash" state={sort} onClick={toggleSort} />
              <SortableTh label="Avg Blind/Flash" title="Longest blind duration caused, averaged over flashes that blinded at least one enemy for 1.1s+" sortKey="blind_flash" state={sort} onClick={toggleSort} />
              <SortableTh label="Blind Duration Dealt" title="Total seconds of blind exposure caused to enemies — a raw, ungated total with no half-blind gate and no role in Utility+" sortKey="bdd" state={sort} onClick={toggleSort} />
              <SortableTh label="Plants" title="Bomb plants" sortKey="pl" state={sort} onClick={toggleSort} />
              <SortableTh label="Defuses" title="Bomb defuses" sortKey="df" state={sort} onClick={toggleSort} />
              <SortableTh label="HE Thrown" title="HE grenades thrown" sortKey="he_thrown" state={sort} onClick={toggleSort} />
              <SortableTh label="HE Damage" title="Damage dealt to enemies by HE grenades" sortKey="he_dmg" state={sort} onClick={toggleSort} />
              <SortableTh label="HE Dmg/Throw" title="HE damage per HE grenade thrown" sortKey="he_dmg_throw" state={sort} onClick={toggleSort} />
              <SortableTh label="CT Smokes Blocking %" title="CT-side smokes that had an enemy within the cloud's radius at some point during its life, out of all CT smokes thrown" sortKey="smoke_block" state={sort} onClick={toggleSort} />
              <SortableTh label="Unused Util/Death" title="Buy-menu value of grenades still held at death, averaged across deaths (Leetify's Unused Utility on Death) — lower is better" sortKey="unused_util" state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              return (
                <tr key={a.player_id} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-secondary)]">
                  {!singlePlayer && <PlayerCell id={a.player_id} name={a.player_name} />}
                  <td className={tdRight}>{a.utility_damage}</td>
                  <td className={tdRight}>{fmtNum(a.teamflash_duration, 1)}</td>
                  <td className={tdRight}>{a.flash_assists}</td>
                  <td className={tdRight}>{a.flashes_leading_to_kill}</td>
                  <td className={tdRight}>{a.enemies_flashed}</td>
                  <td className={tdRight}>{fmtNum(a.enemies_flashed / (a.flashes_thrown || 1), 2)}</td>
                  <td className={tdRight}>{fmtNum(a.blind_duration_max_sum / (a.effective_flashes || 1), 2)}</td>
                  <td className={tdRight}>{fmtNum(a.blind_duration_dealt, 1)}</td>
                  <td className={tdRight}>{a.plants}</td>
                  <td className={tdRight}>{a.defuses}</td>
                  <td className={tdRight}>{a.he_thrown}</td>
                  <td className={tdRight}>{a.he_damage}</td>
                  <td className={tdRight}>{fmtNum(a.he_damage / (a.he_thrown || 1), 1)}</td>
                  <td className={tdRight}>{pct(a.smokes_blocking_push, a.ct_smokes_thrown)}</td>
                  <td className={tdRight}>{fmtNum(a.unused_util_value_on_death_total / (a.deaths || 1), 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Sides (#506) ---

interface SideSplitRow {
  player_id: number;
  player_name: string;
  kills: number;
  assists: number;
  deaths: number;
  killDiff: number;
  damage: number;
  adr: number;
  roundsWon: number;
  roundsLost: number;
  roundWinRate: number;
}

/** CT/T-filtered Kills/Assists/Deaths/Damage/ADR/RW-RL/RWR%, one row per player —
 *  `includeCT`/`includeT` narrow each stat via `splitStat()` against `AggregatedSab`'s raw `_ct`/
 *  `_t` fields, same primitive the match page's own `Scoreboard` filters with. ADR's denominator
 *  and RW-RL/RWR% both come from `rounds_played_ct`/`_t` and `rounds_won_ct`/`_t`
 *  (`deriveRoundsBySide()`, `src/lib/queries/kills.ts`) — a real per-round-per-side tally, not an
 *  approximation: every row here comes from a demo-parsed match (`player_match_sabremetrics`), so
 *  unlike the match page's own `roundsPlayedBySide()` (which approximates from one match's
 *  `target_win_rounds` when it has no better data) there's no fallback to reach for at this scope —
 *  the real round-by-round split is always available. RW-RL/RWR% are round-level, deliberately not
 *  match-level W-L/WR% — a match win/loss can't cleanly attribute to one side once the halftime
 *  swap has both teams play both sides, so a per-player match-outcome-by-side stat wouldn't mean
 *  much; rounds don't have that problem. */
function SideSplitTable({ aggregated, includeCT, includeT, showHeading = true }: {
  aggregated: AggregatedSab[]; includeCT: boolean; includeT: boolean; showHeading?: boolean;
}) {
  const [sort, toggleSort] = useSortState('k');

  const rows = useMemo<SideSplitRow[]>(() => aggregated.map((a) => {
    const kills = splitStat(a, 'kills_ct', 'kills_t', includeCT, includeT);
    const assists = splitStat(a, 'assists_ct', 'assists_t', includeCT, includeT);
    const deaths = splitStat(a, 'deaths_ct', 'deaths_t', includeCT, includeT);
    const damage = splitStat(a, 'damage_ct', 'damage_t', includeCT, includeT);
    const roundsPlayed = splitStat(a, 'rounds_played_ct', 'rounds_played_t', includeCT, includeT);
    const roundsWon = splitStat(a, 'rounds_won_ct', 'rounds_won_t', includeCT, includeT);
    const adr = roundsPlayed > 0 ? damage / roundsPlayed : NaN;
    const roundWinRate = roundsPlayed > 0 ? (roundsWon / roundsPlayed) * 100 : NaN;
    return {
      player_id: a.player_id, player_name: a.player_name, kills, assists, deaths,
      killDiff: kills - deaths, damage, adr, roundsWon, roundsLost: roundsPlayed - roundsWon, roundWinRate,
    };
  }), [aggregated, includeCT, includeT]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sort.col) {
        case 'k':     aVal = a.kills;    bVal = b.kills;    break;
        case 'a':     aVal = a.assists;  bVal = b.assists;  break;
        case 'd':     aVal = a.deaths;   bVal = b.deaths;   break;
        case 'kdiff': aVal = a.killDiff; bVal = b.killDiff; break;
        case 'dmg':   aVal = a.damage;   bVal = b.damage;   break;
        case 'adr':   aVal = a.adr;      bVal = b.adr;      break;
        // wins desc primary, losses asc secondary — same encoding GameStatsTable's own RW-RL sort uses.
        case 'rw':    aVal = a.roundsWon * 1000 - a.roundsLost; bVal = b.roundsWon * 1000 - b.roundsLost; break;
        case 'rwr':   aVal = a.roundWinRate; bVal = b.roundWinRate; break;
        default: return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [rows, sort]);

  return (
    <div>
      {showHeading && <h3 className="text-sm font-semibold mb-3">Side Splits</h3>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className="bg-[var(--color-bg-secondary)]">
              <th className={playerThCls}>Player</th>
              <SortableTh label="Kills" sortKey="k" state={sort} onClick={toggleSort} />
              <SortableTh label="Assists" sortKey="a" state={sort} onClick={toggleSort} />
              <SortableTh label="Deaths" sortKey="d" state={sort} onClick={toggleSort} />
              <SortableTh label="Kill Differential" sortKey="kdiff" state={sort} onClick={toggleSort} />
              <SortableTh label="Damage" sortKey="dmg" state={sort} onClick={toggleSort} />
              <SortableTh label="ADR" title="Average Damage per Round" sortKey="adr" state={sort} onClick={toggleSort} />
              <SortableTh label="RW–RL" title="Rounds Won – Rounds Lost" sortKey="rw" state={sort} onClick={toggleSort} />
              <SortableTh label="RWR%" title="Round Win Rate" sortKey="rwr" state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.player_id} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-secondary)]">
                <PlayerCell id={r.player_id} name={r.player_name} />
                <td className={tdRight}>{r.kills}</td>
                <td className={tdRight}>{r.assists}</td>
                <td className={tdRight}>{r.deaths}</td>
                <td className={tdRight}>{fmtDiff(r.killDiff)}</td>
                <td className={tdRight}>{r.damage.toLocaleString()}</td>
                <td className={tdRight}>{fmtNum(r.adr, 2)}</td>
                <td className={tdRight}>{r.roundsWon}–{r.roundsLost}</td>
                <td className={tdRight}>{fmtNum(r.roundWinRate, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Plus Stats (1-scaled: 1.00 = league average) ---

function PlusStatsTable({ aggregated }: { aggregated: AggregatedSab[] }) {
  const [sort, toggleSort] = useSortState('kast');

  const withPlus = useMemo(() => {
    const leagueAverages = computeLeagueAverages(aggregated);
    return aggregated.map((a) => ({ agg: a, plus: computePlusStats(a, leagueAverages) }));
  }, [aggregated]);

  const sorted = useMemo(() => {
    const copy = [...withPlus];
    copy.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sort.col) {
        case 'kpr': aVal = a.plus.kpr; bVal = b.plus.kpr; break;
        case 'apr': aVal = a.plus.apr; bVal = b.plus.apr; break;
        case 'dpr': aVal = a.plus.dpr; bVal = b.plus.dpr; break;
        case 'adr': aVal = a.plus.adr; bVal = b.plus.adr; break;
        case 'kdr': aVal = a.plus.kdr; bVal = b.plus.kdr; break;
        case 'entry': aVal = a.plus.entry; bVal = b.plus.entry; break;
        case 'kast': aVal = a.plus.kast; bVal = b.plus.kast; break;
        case 'trade': aVal = a.plus.trade; bVal = b.plus.trade; break;
        case 'objective': aVal = a.plus.objective; bVal = b.plus.objective; break;
        case 'utility': aVal = a.plus.utility; bVal = b.plus.utility; break;
        case 'clutch': aVal = a.plus.clutch; bVal = b.plus.clutch; break;
        case 'choke': aVal = a.plus.choke; bVal = b.plus.choke; break;
        case 'aim': aVal = a.plus.aim; bVal = b.plus.aim; break;
        case 'spray': aVal = a.plus.spray; bVal = b.plus.spray; break;
        default: return 0;
      }
      return sort.asc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [withPlus, sort]);

  return (
    <div className="my-6">
      <h3 className="text-sm font-semibold mb-3" title="1.00 = league average. Values above 1 are better than average, below 1 are worse.">Stats Plus</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className="bg-[var(--color-bg-secondary)]">
              <th className={playerThCls}>Player</th>
              <SortableTh label="Kills/Round+" title="Kills per round vs league avg (1.00 = avg)" sortKey="kpr" state={sort} onClick={toggleSort} />
              <SortableTh label="Assists/Round+" title="Assists per round vs league avg (1.00 = avg)" sortKey="apr" state={sort} onClick={toggleSort} />
              <SortableTh label="Deaths/Round+" title="Deaths per round vs league avg (1.00 = avg, lower is better)" sortKey="dpr" state={sort} onClick={toggleSort} />
              <SortableTh label="ADR+" title="Damage per round vs league avg (1.00 = avg)" sortKey="adr" state={sort} onClick={toggleSort} />
              <SortableTh label="K/D+" title="K/D ratio vs league avg (1.00 = avg)" sortKey="kdr" state={sort} onClick={toggleSort} />
              <SortableTh label="Entry+" title="Opening duel success rate (OK / total duels) vs league avg (1.00 = avg)" sortKey="entry" state={sort} onClick={toggleSort} />
              <SortableTh label="KAST+" title="KAST per round vs league avg (1.00 = avg)" sortKey="kast" state={sort} onClick={toggleSort} />
              <SortableTh label="Trade+" title="Trade Kill % (trade kill successes / attempts) vs league avg (1.00 = avg)" sortKey="trade" state={sort} onClick={toggleSort} />
              <SortableTh label="Objective+" title="Objective score (2×plants + 3×defuses) per round vs league avg (1.00 = avg)" sortKey="objective" state={sort} onClick={toggleSort} />
              <SortableTh label="Utility+" title="Weighted average of Flash Assists+, Utility Damage+, Blocking Smokes+, and inverted Teamflash+ vs league avg (1.00 = avg)" sortKey="utility" state={sort} onClick={toggleSort} />
              <SortableTh label="Clutch+" title="Clutch score (1v1 wins + 3×1v2 wins) per round vs league avg (1.00 = avg)" sortKey="clutch" state={sort} onClick={toggleSort} />
              <SortableTh label="Choke+" title="Choke score (1v1 losses + 2×1v2 losses + 5×2v1 losses) per round vs league avg (1.00 = avg, lower is better)" sortKey="choke" state={sort} onClick={toggleSort} />
              <SortableTh label="Aim+" title="Weighted blend of Accuracy+ (35%), Head Accuracy+ (40%), and Counter-Strafe+ (25%) vs league avg (1.00 = avg)" sortKey="aim" state={sort} onClick={toggleSort} />
              <SortableTh label="Spray+" title="Spray Accuracy vs league avg (1.00 = avg)" sortKey="spray" state={sort} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ agg, plus }) => (
              <tr key={agg.player_id} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-secondary)]">
                <PlayerCell id={agg.player_id} name={agg.player_name} />
                <td className={tdRight} style={plusStyle(plus.kpr)}>{fmtNum(plus.kpr, 2)}</td>
                <td className={tdRight} style={plusStyle(plus.apr)}>{fmtNum(plus.apr, 2)}</td>
                <td className={tdRight} style={plusStyle(2 - plus.dpr)}>{fmtNum(plus.dpr, 2)}</td>
                <td className={tdRight} style={plusStyle(plus.adr)}>{fmtNum(plus.adr, 2)}</td>
                <td className={tdRight} style={plusStyle(plus.kdr)}>{fmtNum(plus.kdr, 2)}</td>
                <td className={tdRight} style={plusStyle(plus.entry)}>{fmtNum(plus.entry, 2)}</td>
                <td className={tdRight} style={plusStyle(plus.kast)}>{fmtNum(plus.kast, 2)}</td>
                <td className={tdRight} style={plusStyle(plus.trade)}>{fmtNum(plus.trade, 2)}</td>
                <td className={tdRight} style={plusStyle(plus.objective)}>{fmtNum(plus.objective, 2)}</td>
                <td className={tdRight} style={plusStyle(plus.utility)}>{fmtNum(plus.utility, 2)}</td>
                <td className={tdRight} style={plusStyle(plus.clutch)}>{fmtNum(plus.clutch, 2)}</td>
                <td className={tdRight} style={plusStyle(2 - plus.choke)}>{fmtNum(plus.choke, 2)}</td>
                <td className={tdRight} style={plusStyle(plus.aim)}>{fmtNum(plus.aim, 2)}</td>
                <td className={tdRight} style={plusStyle(plus.spray)}>{fmtNum(plus.spray, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Single-player layout ---
//
// A one-row table is awkward (lots of columns, a single line of data, forced
// horizontal scroll on mobile). For a single player we transpose the same
// metrics into a label/value stat-tile grid — the shared `StatTileGrid`, so it
// matches the player Overview panel exactly. See docs/visual-conventions.md.

interface SinglePlayerTiles {
  impact: StatTile[];
  duels: StatTile[];
  mechanics: StatTile[];
  /** Per-weapon kills/HS%/deaths for this player — the Weapons tab resolves one filter selection's
   *  stat from this via `resolveWeaponFilterStat()` (favorite, a specific weapon, or a whole
   *  category) and renders it as tiles, same as `WeaponsTable` does per row. */
  weaponStats: WeaponKillStat[];
  /** Rendered as `WeaponBar`s below the weapons tiles — a ranked list, not a fixed small set of
   *  named metrics, so it doesn't fit the tile grid's label/value shape. */
  topWeapons: WeaponKillStat[];
  /** Per-economy-tier shot/accuracy/damage/rounds for this player — the Economy tab resolves the
   *  filter's selected tier's stat from this via `resolveEconomyStat()` and renders it as tiles,
   *  same as `EconomyTable` does per row. */
  economyStats: EconomyTierStat[];
  /** No-scope/wallbang/blind/knife kills, totaled across every weapon — see `FlairTable`. */
  flair: StatTile[];
  trades: StatTile[];
  utility: StatTile[];
  plus: StatTile[];
}

function buildSinglePlayerTiles(agg: AggregatedSab, leagueAggregated: AggregatedSab[], kills: MatchKillRow[], economyRows: EconomyMatchRow[]): SinglePlayerTiles {
  const totalDuels = agg.opening_kills + agg.opening_deaths;
  const clutchAttempts = agg.clutch_1v1_attempts + agg.clutch_1v2_attempts;
  const clutchWins = agg.clutch_1v1_wins + agg.clutch_1v2_wins;

  const duels: StatTile[] = [
    { label: 'Opening Duels', title: 'First kill and first death of each round (wins-losses)', value: <OpeningDuels wins={agg.opening_kills} losses={agg.opening_deaths} /> },
    { label: 'Opening %', title: 'Percentage of rounds where this player took the opening duel', value: pct(totalDuels, agg.rounds_played) },
    { label: 'Opening Success', title: 'Opening kills / (opening kills + opening deaths)', value: pct(agg.opening_kills, totalDuels) },
  ];

  const impact: StatTile[] = [
    { label: 'KAST', title: 'Percentage of rounds with a Kill, Assist, Survived, or Traded', value: pct(agg.kast_rounds, agg.rounds_played) },
    { label: 'Double Kills', title: 'Rounds where both opponents were eliminated', value: agg.two_k_rounds },
    { label: 'Teamkills', title: 'Teammates killed', value: agg.teamkills },
    { label: '1v1 Clutches', title: '1v1 clutch wins / attempts', value: `${agg.clutch_1v1_wins}/${agg.clutch_1v1_attempts}` },
    { label: '1v2 Clutches', title: '1v2 clutch wins / attempts', value: `${agg.clutch_1v2_wins}/${agg.clutch_1v2_attempts}` },
    { label: '2v1 Losses', title: 'Rounds this player\'s side had a 2-vs-1 numbers advantage and still lost, out of all 2v1 advantages (the natural stat behind Choke Score)', value: `${agg.clutch_2v1_attempts - agg.clutch_2v1_wins}/${agg.clutch_2v1_attempts}` },
    { label: 'Clutch %', title: 'Overall clutch success rate (1v1 + 1v2 wins / attempts)', value: pct(clutchWins, clutchAttempts) },
  ];

  const mechanics: StatTile[] = [
    { label: 'Shots Fired', title: 'Shots fired (guns only, not gated on enemy visibility)', value: agg.shots_fired },
    { label: 'Accuracy', title: 'Shots that hit an enemy / shots fired (guns only, not gated on enemy visibility)', value: pct(agg.shots_hit, agg.shots_fired) },
    { label: 'Head Accuracy', title: 'Hits landing on the head / total hits, excluding AWP shots (matches Leetify\'s Headshot Accuracy)', value: pct(agg.headshot_hits_no_awp, agg.shots_hit_no_awp) },
    { label: 'Counter-Strafe %', title: 'Rifle shots fired at under 34% of max speed / all standing rifle shots (crouched shots excluded)', value: pct(agg.counter_strafe_good_shots, agg.counter_strafe_shots) },
    { label: 'Spray Accuracy', title: 'Hits / shots within sequences of 3+ consecutive rifle shots', value: pct(agg.spray_shots_hit, agg.spray_shots_fired) },
    { label: 'Rounds Dropped/Reload', title: 'Bullets still in the magazine (wasted) when reloading, averaged across every reload including clean ones', value: fmtNum(agg.rounds_dropped_on_reload_total / (agg.reloads_total || 1), 2) },
  ];

  const trades: StatTile[] = [
    { label: 'Trade Kill Opps', title: 'Trade kill opportunities: times a teammate died while this player was still alive (the chance to trade existed)', value: agg.trade_kill_opportunities },
    { label: 'Trade Kill Attempts', title: 'Trade kill attempts: opportunities where this player damaged the killer within the trade window', value: agg.trade_kill_attempts },
    { label: 'Trade Kills', title: 'Trade kill successes / attempts: times you killed the enemy who killed your teammate, out of the times you tried to', value: `${agg.trade_kill_successes}/${agg.trade_kill_attempts}` },
    { label: 'Traded Death Opps', title: 'Traded death opportunities: times this player died while at least one teammate was still alive (someone had the chance to trade them)', value: agg.traded_death_opportunities },
    { label: 'Traded Death Attempts', title: 'Traded death attempts: opportunities where a teammate damaged the killer within the trade window', value: agg.traded_death_attempts },
    { label: 'Traded Deaths', title: 'Traded death successes / attempts: times a teammate killed the enemy who killed you, out of the times a teammate tried to', value: `${agg.traded_death_successes}/${agg.traded_death_attempts}` },
  ];

  const utility: StatTile[] = [
    { label: 'Utility Damage', title: 'Damage dealt with grenades (HE, molotov, incendiary) — sourced from CS2\'s own m_iUtilityDamage engine accumulator, which combines both', value: agg.utility_damage },
    { label: 'Teamflash Duration', title: 'Total seconds spent blinding teammates — subtracted from Utility Score', value: fmtNum(agg.teamflash_duration, 1) },
    { label: 'Flash Assists', title: 'Kills by a teammate on an enemy you flashbanged', value: agg.flash_assists },
    { label: 'Flashes → Kill', title: 'Enemies killed by anyone (including you) while still blinded by your flash — Leetify\'s flash-effectiveness definition', value: agg.flashes_leading_to_kill },
    { label: 'Enemies Flashed', title: 'Enemy players blinded by your flashbangs', value: agg.enemies_flashed },
    { label: 'Enemies Flashed/Flash', title: 'Enemies flashed (1.1s+) per flashbang thrown', value: fmtNum(agg.enemies_flashed / (agg.flashes_thrown || 1), 2) },
    { label: 'Avg Blind/Flash', title: 'Longest blind duration caused, averaged over flashes that blinded at least one enemy for 1.1s+', value: fmtNum(agg.blind_duration_max_sum / (agg.effective_flashes || 1), 2) },
    { label: 'Blind Duration Dealt', title: 'Total seconds of blind exposure caused to enemies — a raw, ungated total with no half-blind gate and no role in Utility+', value: fmtNum(agg.blind_duration_dealt, 1) },
    { label: 'Plants', title: 'Bomb plants', value: agg.plants },
    { label: 'Defuses', title: 'Bomb defuses', value: agg.defuses },
    { label: 'HE Thrown', title: 'HE grenades thrown', value: agg.he_thrown },
    { label: 'HE Damage', title: 'Damage dealt to enemies by HE grenades', value: agg.he_damage },
    { label: 'HE Dmg/Throw', title: 'HE damage per HE grenade thrown', value: fmtNum(agg.he_damage / (agg.he_thrown || 1), 1) },
    { label: 'CT Smokes Blocking %', title: 'CT-side smokes that had an enemy within the cloud\'s radius at some point during its life, out of all CT smokes thrown', value: pct(agg.smokes_blocking_push, agg.ct_smokes_thrown) },
    { label: 'Unused Util/Death', title: 'Buy-menu value of grenades still held at death, averaged across deaths (Leetify\'s Unused Utility on Death) — lower is better', value: fmtNum(agg.unused_util_value_on_death_total / (agg.deaths || 1), 0) },
  ];

  // Plus stats need the league as a baseline; comparing a player to only
  // themselves yields all 1.00, so only render when we have other players.
  const hasLeagueBaseline = leagueAggregated.length > 1;
  const plus = hasLeagueBaseline ? computePlusStats(agg, computeLeagueAverages(leagueAggregated)) : null;
  const plusTiles: StatTile[] = plus ? [
    { label: 'Kills/Round+', title: 'Kills per round vs league avg (1.00 = avg)', value: fmtNum(plus.kpr, 2), valueStyle: plusStyle(plus.kpr) },
    { label: 'Assists/Round+', title: 'Assists per round vs league avg (1.00 = avg)', value: fmtNum(plus.apr, 2), valueStyle: plusStyle(plus.apr) },
    { label: 'Deaths/Round+', title: 'Deaths per round vs league avg (1.00 = avg, lower is better)', value: fmtNum(plus.dpr, 2), valueStyle: plusStyle(2 - plus.dpr) },
    { label: 'ADR+', title: 'Damage per round vs league avg (1.00 = avg)', value: fmtNum(plus.adr, 2), valueStyle: plusStyle(plus.adr) },
    { label: 'K/D+', title: 'K/D ratio vs league avg (1.00 = avg)', value: fmtNum(plus.kdr, 2), valueStyle: plusStyle(plus.kdr) },
    { label: 'Entry+', title: 'Opening duel success rate (OK / total duels) vs league avg (1.00 = avg)', value: fmtNum(plus.entry, 2), valueStyle: plusStyle(plus.entry) },
    { label: 'KAST+', title: 'KAST per round vs league avg (1.00 = avg)', value: fmtNum(plus.kast, 2), valueStyle: plusStyle(plus.kast) },
    { label: 'Trade+', title: 'Trade Kill % (trade kill successes / attempts) vs league avg (1.00 = avg)', value: fmtNum(plus.trade, 2), valueStyle: plusStyle(plus.trade) },
    { label: 'Objective+', title: 'Objective score (2×plants + 3×defuses) per round vs league avg (1.00 = avg)', value: fmtNum(plus.objective, 2), valueStyle: plusStyle(plus.objective) },
    { label: 'Utility+', title: 'Weighted average of Flash Assists+, Utility Damage+, Blocking Smokes+, and inverted Teamflash+ vs league avg (1.00 = avg)', value: fmtNum(plus.utility, 2), valueStyle: plusStyle(plus.utility) },
    { label: 'Clutch+', title: 'Clutch score (1v1 wins + 3×1v2 wins) per round vs league avg (1.00 = avg)', value: fmtNum(plus.clutch, 2), valueStyle: plusStyle(plus.clutch) },
    { label: 'Choke+', title: 'Choke score (1v1 losses + 2×1v2 losses + 5×2v1 losses) per round vs league avg (1.00 = avg, lower is better)', value: fmtNum(plus.choke, 2), valueStyle: plusStyle(2 - plus.choke) },
    { label: 'Aim+', title: 'Weighted blend of Accuracy+ (35%), Head Accuracy+ (40%), and Counter-Strafe+ (25%) vs league avg (1.00 = avg)', value: fmtNum(plus.aim, 2), valueStyle: plusStyle(plus.aim) },
    { label: 'Spray+', title: 'Spray Accuracy vs league avg (1.00 = avg)', value: fmtNum(plus.spray, 2), valueStyle: plusStyle(plus.spray) },
  ] : [];

  const weaponStats = aggregateWeaponKillStats(kills, agg.player_id);
  const topWeapons = weaponStats.filter((w) => w.kills > 0).slice(0, 8);

  const economyStats = aggregateEconomyStats(economyRows, agg.player_id);

  const flairStat = aggregateFlairKillStats(kills, agg.player_id);
  const flair: StatTile[] = [
    { label: 'No-scope', title: 'No-scope kills, across every weapon', value: flairStat.noscopeKills },
    { label: 'Wallbang', title: 'Wallbang kills (bullet penetrated a surface), across every weapon', value: flairStat.wallbangKills },
    { label: 'Blind', title: 'Kills scored while the attacker was flashed, across every weapon', value: flairStat.blindKills },
    { label: 'Midair', title: 'Mid-air kills (attacker was airborne), across every weapon', value: flairStat.midairKills },
    { label: 'Knife', title: 'Knife kills', value: flairStat.knifeKills },
    { label: 'Fall Deaths', title: 'Deaths to fall damage or other environmental causes — never has a real attacker, so this is a death count, not a kill count', value: flairStat.fallDamageDeaths },
    { label: 'C4 Deaths', title: 'Deaths to bomb detonation — never has a real attacker, so this is a death count, not a kill count', value: flairStat.c4Deaths },
  ];

  return { impact, duels, mechanics, weaponStats, topWeapons, economyStats, flair, trades, utility, plus: plusTiles };
}

/** The single-player counterpart of `resolvePlayerWeaponRow()`'s table cells — same resolved
 *  `WeaponFilterStat` (favorite, the filter's selected weapon, or a whole category), as a
 *  `StatTile[]`. The five accuracy tiles are omitted entirely (rather than shown as dashes) when
 *  `stat.accuracy` is `null` — this selection has no such concept at all (#474). */
function buildWeaponTiles(weaponStats: WeaponKillStat[], selectedFilter: WeaponFilter, accuracy: PlayerWeaponAccuracy | undefined): StatTile[] {
  const stat: WeaponFilterStat = resolveWeaponFilterStat(weaponStats, selectedFilter, accuracy);
  const titleSuffix = selectedFilter.kind === 'favorite' ? "this player's favorite weapon" : stat.label;
  const tiles: StatTile[] = [
    { label: 'Weapon', title: 'The weapon (or category) these stats are for', value: <WeaponLabel weapon={stat.weapon} label={stat.label} /> },
    { label: 'Kills With', title: `Credited kills with ${titleSuffix} (excludes self-kills and teamkills)`, value: stat.kills },
    { label: 'HS% With', title: `Headshot kills / kills with ${titleSuffix}`, value: pct(stat.headshotKills, stat.kills) },
    { label: 'NS With', title: `No-scope kills with ${titleSuffix}`, value: stat.noscopeKills },
    { label: 'WB With', title: `Wallbang kills with ${titleSuffix}`, value: stat.wallbangKills },
    { label: 'Blind With', title: `Kills scored while flashed, with ${titleSuffix}`, value: stat.blindKills },
    { label: 'Midair With', title: `Mid-air kills with ${titleSuffix}`, value: stat.midairKills },
    { label: 'Deaths To', title: `Deaths to ${titleSuffix}`, value: stat.deaths },
  ];
  if (stat.accuracy) {
    const acc = stat.accuracy;
    tiles.push(
      { label: 'Shots Fired', title: `Shots fired with ${titleSuffix}`, value: acc.shots_fired },
      { label: 'Accuracy', title: `Shots that hit an enemy / shots fired, with ${titleSuffix}`, value: pct(acc.shots_hit, acc.shots_fired) },
      { label: 'Head Accuracy', title: `Hits landing on the head / total hits, with ${titleSuffix}`, value: pct(acc.headshot_hits, acc.shots_hit) },
      { label: 'Damage/Round', title: `Damage dealt with ${titleSuffix} / rounds played with it`, value: fmtNum(acc.rounds_played > 0 ? acc.damage_dealt / acc.rounds_played : 0, 1) },
      { label: 'Rounds', title: `Rounds this player used ${titleSuffix} in at least once`, value: acc.rounds_played },
    );
  }
  return tiles;
}

/** The single-player counterpart of `resolvePlayerEconomyRow()`'s table cells — same resolved
 *  `EconomyTierStat` for the filter's selected tier, as a `StatTile[]`. */
function buildEconomyTiles(economyStats: EconomyTierStat[], selectedTier: string): StatTile[] {
  const stat = resolveEconomyStat(economyStats, selectedTier);
  const titleSuffix = `${economyTierLabel(selectedTier)} rounds`;
  return [
    { label: 'Rounds Played', title: `Rounds played at ${titleSuffix}`, value: stat.rounds_played },
    { label: 'W-L', title: `Rounds won vs. lost at ${titleSuffix}`, value: `${stat.rounds_won}-${stat.rounds_played - stat.rounds_won}` },
    { label: 'Shots Fired', title: `Shots fired (guns only) at ${titleSuffix}`, value: stat.shots_fired },
    { label: 'Accuracy', title: `Shots that hit an enemy / shots fired, at ${titleSuffix}`, value: pct(stat.shots_hit, stat.shots_fired) },
    { label: 'Headshot %', title: `Headshot hits / hits, at ${titleSuffix}`, value: pct(stat.headshot_hits, stat.shots_hit) },
    { label: 'Damage/Round', title: `Damage dealt per round at ${titleSuffix}`, value: fmtNum(stat.damage_dealt / (stat.rounds_played || 1), 1) },
  ];
}

// --- Sub-tabs ---
//
// Five sections is too much to stack on one page (both the wide multi-player tables and the
// single-player tile grids) — see the Impact/Mechanics/Trades split above. One tab state drives
// both render paths so they never drift out of sync with each other.

type SubTab = 'impact' | 'duels' | 'mechanics' | 'weapons' | 'economy' | 'flair' | 'trades' | 'utility' | 'plus' | 'sides';

// Ordered to roughly match Leetify's match-page grouping (Aim, then situational Duels/Trades,
// then Impact, then Utility) — see #173's Leetify-parity discussion. Weapons sits right after Aim
// (#452) since both are gun-choice/precision stats; Economy sits right after Weapons (#481) since
// it's the same per-player shot/accuracy/damage breakdown pattern, just bucketed by round-buy tier
// instead of gun; Flair sits right after Economy (#465) since it's the same per-weapon kill data
// rolled up into all-weapons totals instead of broken out by gun. Sides and Stats Plus have no
// Leetify analog (they're DGLS's own), so they stay last.
//
// Sides is a single filterable table (CT/T checkboxes above one K/D/A/Damage/ADR/RW-RL/RWR% row
// set, gated on the unscoped `hasSideData` prop — see its doc comment below), not the wide
// CT|T-paired-column layout #482 originally shipped — that reiterated Stats > Basic Stats' own
// K/D/A columns under a more confusing layout. It lives in Advanced Stats rather than on Basic
// Stats (#506) because Advanced Stats already means "demo-backed" to users, so a CT/T filter here
// needs no coverage caveat the way bolting one onto Basic Stats' always-accurate all-time total
// would. `AggregatedSab` carries the raw `_ct`/`_t` fields (including `rounds_played_ct`/`_t` and
// `rounds_won_ct`/`_t`) this reads directly (`aggregateRows()`, `src/lib/queries/sabremetrics.ts`),
// same as the match page's own Scoreboard CT/T checkboxes (`MatchTabView.tsx`) via the shared
// `splitStat()`. ADR and RW-RL/RWR% are all side-filterable here with real per-round data
// (`deriveRoundsBySide()`, `src/lib/queries/kills.ts`) — see `SideSplitTable`'s own doc comment for
// why this scope needs no approximation the way the match page's `roundsPlayedBySide()` does, and
// why RW-RL/RWR% are round-level rather than the match-level W-L/WR% Basic Stats' Game Stats tab
// shows (a match win/loss can't cleanly attribute to one side once the halftime swap has both
// teams play both sides).
const ALL_SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'mechanics', label: 'Aim' },
  { key: 'weapons', label: 'Weapons' },
  { key: 'economy', label: 'Economy' },
  { key: 'flair', label: 'Flair' },
  { key: 'duels', label: 'Opening Duels' },
  { key: 'trades', label: 'Trades' },
  { key: 'impact', label: 'Impact' },
  { key: 'utility', label: 'Utility' },
  { key: 'sides', label: 'Sides' },
  { key: 'plus', label: 'Stats Plus' },
];

/** Renders `render(agg)` once per `groups`, filtered to that group's `playerIds` and wrapped in
 *  its `header` (typically a `<TeamHeader>`, supplied by the caller) and side tint — the
 *  match-page shape. Falls back to a single ungrouped `render(aggregated)` call for the
 *  season/career leaderboard shape, where `groups` is omitted. */
function GroupedOrFlat({
  aggregated,
  groups,
  render,
}: {
  aggregated: AggregatedSab[];
  groups?: TeamGroup[];
  render: (agg: AggregatedSab[]) => React.ReactNode;
}) {
  if (!groups) return <>{render(aggregated)}</>;
  return (
    <>
      {groups.map((g, i) => (
        <div key={g.key} className={i > 0 ? 'mt-6' : undefined}>
          {g.header}
          <div className={`faction-tint ${factionClass(g.side)}`}>
            {render(aggregated.filter((a) => g.playerIds.has(a.player_id)))}
          </div>
        </div>
      ))}
    </>
  );
}

export default function SabremetricsLeaderboardView({
  rows,
  leagueRows,
  singlePlayer = false,
  teamGroups,
  showPlusStats = true,
  kills = [],
  weaponClassStats = [],
  economyRows = [],
  hasEconomyData = false,
  damageEvents = [],
  roundEconomy = [],
  roundHistory = [],
  matches = [],
  rounds = [],
  hasSideData = false,
}: {
  rows: SabremetricStatRow[];
  /** League-wide rows used as the Plus-stat baseline in single-player mode. Defaults to `rows`. */
  leagueRows?: SabremetricStatRow[];
  singlePlayer?: boolean;
  /** Match-page mode: split the tables into per-team blocks instead of one flat leaderboard.
   *  Ignored in singlePlayer mode. */
  teamGroups?: TeamGroup[];
  /** Plus stats compare a player to a league-wide baseline — not meaningful over just the
   *  handful of players in one match, so match-page callers should pass `false`. */
  showPlusStats?: boolean;
  /** Kill rows behind the Weapons sub-tab (#452) — same scope as `rows` (one match, one player,
   *  or league-wide). Empty is fine; the tab still renders, just with zeroed/dash values, until a
   *  demo is (re)parsed with `match_kills` populated. */
  kills?: MatchKillRow[];
  /** `player_match_weapon_stats` rows (#279/#474) behind the Weapons sub-tab's category accuracy
   *  breakdown — same scope as `kills`. Empty is fine, same honesty rule as `kills`. */
  weaponClassStats?: WeaponClassMatchRow[];
  /** Rows behind the Economy sub-tab (#481) — same scope as `rows` (season-filtered, in
   *  particular), so this alone isn't a safe tab-gating signal (see `hasEconomyData` below). */
  economyRows?: EconomyMatchRow[];
  /** Gates the Economy sub-tab. Unlike `kills` (always shown, zeroed until a demo is parsed), an
   *  unplayed/not-yet-reparsed match or season has no economy rows to show at all, so the tab must
   *  hide rather than showing dead. Defaults to `false`, not derived from `economyRows` — a caller
   *  that wires `economyRows` must pass this explicitly, computed from its own season-*unscoped*
   *  economy rows, per docs/patterns.md's "Gate a tab on data": the gate signal must be "computed unscoped by
   *  whatever transient filter (season, side, …) the page also applies, so the tab doesn't flicker
   *  in and out as the user toggles that filter." A caller that passes season-filtered
   *  `economyRows` without also passing this would otherwise silently boot the viewer off the tab
   *  the moment they filter to a season with no parsed economy data — deriving the default from
   *  `economyRows.length` would reintroduce exactly that bug for any future caller who forgets to
   *  override it, so the unsafe inference isn't offered as a default at all. */
  hasEconomyData?: boolean;
  /** This match's demo-derived damage events (#519) — feeds the Economy sub-tab's round-by-round
   *  chart tooltip. Only meaningful alongside `roundEconomy` below; a season/career caller that
   *  never wires `roundEconomy` doesn't need this either. */
  damageEvents?: MatchDamageEventRow[];
  /** This match's `match_round_economy` rows, one row per (round, player) — drives the Economy
   *  sub-tab's round-by-round money/kills/damage chart (#519). Only ever populated by the match
   *  page (`teamGroups` is what makes the chart meaningful — a season/career view spans many
   *  matches' round numbers at once, so it never wires this). Empty is fine; the chart simply
   *  doesn't render, same as an unplayed/not-yet-reparsed match. */
  roundEconomy?: MatchRoundEconomyRow[];
  /** This match's round-by-round outcomes (`matches.round_history`) — drives the round-by-round
   *  chart's win/loss background bands (#519). Only meaningful alongside `roundEconomy`; a
   *  season/career caller never wires either. */
  roundHistory?: RoundHistoryEntry[];
  /** Match veto/side data behind the Sides sub-tab (#506) — same shape `BasicStatsView`'s own
   *  `matches` prop takes, and typically the exact same array a caller already passes there.
   *  Defaults to `[]` (the match page, which filters CT/T per-team via `Scoreboard` instead, never
   *  wires this); tab visibility is driven by `hasSideData` below, not by this array's contents. */
  matches?: MatchPickBanInput[];
  /** Round-level outcomes behind the Sides sub-tab's Round Win% panel — same shape and scope as
   *  `BasicStatsView`'s own `rounds` prop. Empty is fine; Round Win% just shows a dash. */
  rounds?: RoundOutcome[];
  /** Gates the Sides sub-tab. Same reasoning as `hasEconomyData` above: a caller that
   *  season-filters `matches` (e.g. the career page's `selectedSeason` toggle) must pass this
   *  separately, computed from its own unscoped match list — deriving the default from
   *  `matches.length` would silently boot the viewer off the tab the moment they filter to a
   *  season with no matches, per docs/patterns.md's "Gate a tab on data". Defaults to `false`. */
  hasSideData?: boolean;
}) {
  const aggregated = useMemo(() => aggregateRows(rows), [rows]);
  const leagueAggregated = useMemo(() => aggregateRows(leagueRows ?? rows), [leagueRows, rows]);
  // `showPlusStats`, `hasEconomyData`, and `hasSideData` are each stable across this component's
  // lifetime for any one caller — a page either wires the data or doesn't, and callers that
  // season-filter their scoped array (`economyRows`/`matches`) pass the gate separately from an
  // unscoped source (see each gate prop's doc comment above) — so `subTabs` is already the right
  // key list to validate against — no second `resolveTab` stage needed (unlike `SeasonTabView`,
  // which filters its tab list on data that isn't known until render).
  const subTabs = ALL_SUB_TABS.filter((t) =>
    (t.key !== 'plus' || showPlusStats) && (t.key !== 'economy' || hasEconomyData) && (t.key !== 'sides' || hasSideData));
  const [sub, setSub] = useTabState(subTabs.map((t) => t.key), 'mechanics', 'sub');
  const [includeCT, setIncludeCT] = useState(true);
  const [includeT, setIncludeT] = useState(true);
  // Gated on `sub === 'sides'`, not just `matches`/`rounds` — otherwise this O(matches + rounds)
  // pass over the full season/career round set would re-run on every Advanced Stats visit
  // (default sub-tab is Aim), even for viewers who never open Sides.
  const perSideStats = useMemo(
    () => (sub === 'sides' ? aggregatePerSideStats(matches, rounds) : []),
    [sub, matches, rounds],
  );
  /** Favorite weapon by default; a `WeaponFilter` selects one specific weapon or a whole category
   *  instead (#474). Lives here, not inside `WeaponsTable`, so a match page's two team tables (and
   *  the single-player tile view) share one selection and one dropdown. */
  const [weaponFilter, setWeaponFilter] = useState<WeaponFilter>(FAVORITE_WEAPON_FILTER);
  // Single-player mode only ever needs one player's accuracy, but grouping is a single O(rows)
  // pass regardless of how many players are pulled out of it afterward, so there's no cheaper way
  // to look up just one.
  const singlePlayerAccuracy = useMemo(
    () => (aggregated.length > 0 ? groupWeaponAccuracyByPlayer(weaponClassStats).get(aggregated[0].player_id) : undefined),
    [weaponClassStats, aggregated],
  );
  /** Same idea as `weaponFilter`, for the Economy sub-tab's tier picker — always one explicit tier
   *  (no "most played" default; see the Economy section comment above `EconomyFilterSelect`).
   *  Defaults to Full Buy, the tier most rounds in a match fall into. */
  const [economyFilter, setEconomyFilter] = useState<string>('full_buy');

  // Memoized (not called inline in the singlePlayer branch below) so picking a different weapon
  // filter — which only ever changes buildWeaponTiles()'s cheap lookup — doesn't also re-run
  // buildSinglePlayerTiles()'s full aggregateWeaponKillStats() scan over `kills` plus every other
  // tile section. Computed unconditionally (hooks can't be called only when singlePlayer is true)
  // but short-circuits to null outside single-player mode, so the multi-player render path never
  // pays for it.
  const singlePlayerTiles = useMemo(
    () => (singlePlayer && aggregated.length > 0 ? buildSinglePlayerTiles(aggregated[0], leagueAggregated, kills, economyRows) : null),
    [singlePlayer, aggregated, leagueAggregated, kills, economyRows],
  );
  const singlePlayerWeaponTiles = useMemo(
    () => buildWeaponTiles(singlePlayerTiles?.weaponStats ?? [], weaponFilter, singlePlayerAccuracy),
    [singlePlayerTiles, weaponFilter, singlePlayerAccuracy],
  );
  const singlePlayerEconomyTiles = useMemo(
    () => buildEconomyTiles(singlePlayerTiles?.economyStats ?? [], economyFilter),
    [singlePlayerTiles, economyFilter],
  );
  /** `{id, name, side}` for every rostered player, in `teamGroups` order — the round-by-round
   *  chart's own input shape, which colors/groups lines by side rather than SHIRTS/SKINS identity
   *  (see `RoundEconomyChart`). Only ever non-empty on the match page (`teamGroups` set); a
   *  season/career caller has no single round sequence to plot against. */
  const roundEconomyPlayers = useMemo(() => {
    if (!teamGroups) return [];
    const nameById = new Map(aggregated.map((a) => [a.player_id, a.player_name]));
    return teamGroups.flatMap((g) =>
      [...g.playerIds].sort((a, b) => a - b).map((id) => ({ id, name: nameById.get(id) ?? `#${id}`, side: g.side })),
    );
  }, [teamGroups, aggregated]);
  /** Each team's match-long display side, keyed by `TeamGroup.key` ('shirts'/'skins' —
   *  `MatchTabView`'s own convention) — lets the round-by-round chart tint a round's winner band
   *  by the *team* that won, not the round's actual (half-swapping) side. */
  const roundEconomyTeamSides = useMemo(() => {
    const shirts = teamGroups?.find((g) => g.key === 'shirts')?.side ?? null;
    const skins = teamGroups?.find((g) => g.key === 'skins')?.side ?? null;
    return { shirts, skins };
  }, [teamGroups]);

  if (aggregated.length === 0) {
    return <EmptyState message="No sabremetric data available. Upload demos on match pages to populate advanced stats." />;
  }

  const tabBar = (
    <div role="tablist" className="flex flex-wrap items-center gap-2">
      {subTabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={sub === t.key} type="button" className={tabCls(sub === t.key)} onClick={() => setSub(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );

  if (singlePlayer) {
    const tiles = singlePlayerTiles!;
    return (
      <div className="space-y-4">
        {tabBar}
        {sub === 'impact' && <StatTileGrid heading="Impact" tiles={tiles.impact} />}
        {sub === 'duels' && <StatTileGrid heading="Opening Duels" tiles={tiles.duels} />}
        {sub === 'mechanics' && <StatTileGrid heading="Mechanics" tiles={tiles.mechanics} />}
        {sub === 'weapons' && (
          <div className="space-y-4">
            <WeaponFilterSelect kills={kills} value={weaponFilter} onChange={setWeaponFilter} />
            <StatTileGrid heading="Weapons" tiles={singlePlayerWeaponTiles} />
            {tiles.topWeapons.length > 0 && (
              <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-4 py-2">
                {tiles.topWeapons.map((w) => (
                  <WeaponBar key={w.weapon} weapon={w.weapon} kills={w.kills} maxKills={tiles.topWeapons[0].kills} />
                ))}
              </div>
            )}
          </div>
        )}
        {sub === 'economy' && (
          <div className="space-y-4">
            <EconomyFilterSelect value={economyFilter} onChange={setEconomyFilter} />
            <StatTileGrid heading="Economy" tiles={singlePlayerEconomyTiles} />
          </div>
        )}
        {sub === 'flair' && <StatTileGrid heading="Flair" tiles={tiles.flair} />}
        {sub === 'trades' && <StatTileGrid heading="Trades" tiles={tiles.trades} />}
        {sub === 'utility' && <StatTileGrid heading="Utility" tiles={tiles.utility} />}
        {sub === 'plus' && tiles.plus.length > 0 && (
          <StatTileGrid heading="Stats Plus" hint="1.00 = league average. Values above 1 are better than average, below 1 are worse." tiles={tiles.plus} />
        )}
      </div>
    );
  }

  const showHeading = !teamGroups;

  return (
    <div className="space-y-4">
      {tabBar}
      {sub === 'impact' && (
        <GroupedOrFlat aggregated={aggregated} groups={teamGroups} render={(agg) => (
          <ImpactTable aggregated={agg} singlePlayer={singlePlayer} showHeading={showHeading} />
        )} />
      )}
      {sub === 'duels' && (
        <GroupedOrFlat aggregated={aggregated} groups={teamGroups} render={(agg) => (
          <OpeningDuelsTable aggregated={agg} singlePlayer={singlePlayer} showHeading={showHeading} />
        )} />
      )}
      {sub === 'mechanics' && (
        <GroupedOrFlat aggregated={aggregated} groups={teamGroups} render={(agg) => (
          <MechanicsTable aggregated={agg} singlePlayer={singlePlayer} showHeading={showHeading} />
        )} />
      )}
      {sub === 'weapons' && (
        <div className="space-y-3">
          <WeaponFilterSelect kills={kills} value={weaponFilter} onChange={setWeaponFilter} />
          <GroupedOrFlat aggregated={aggregated} groups={teamGroups} render={(agg) => (
            <WeaponsTable aggregated={agg} kills={kills} weaponClassStats={weaponClassStats} selectedFilter={weaponFilter} singlePlayer={singlePlayer} showHeading={showHeading} />
          )} />
        </div>
      )}
      {sub === 'economy' && (
        <div className="space-y-3">
          {roundEconomy.length > 0 && (
            <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-4 py-3">
              <h3 className="text-sm font-semibold mb-3">Round Economy</h3>
              <RoundEconomyChart
                players={roundEconomyPlayers}
                roundEconomy={roundEconomy}
                kills={kills}
                damageEvents={damageEvents}
                roundHistory={roundHistory}
                teamSides={roundEconomyTeamSides}
              />
            </div>
          )}
          <EconomyFilterSelect value={economyFilter} onChange={setEconomyFilter} />
          <GroupedOrFlat aggregated={aggregated} groups={teamGroups} render={(agg) => (
            <EconomyTable aggregated={agg} economyRows={economyRows} selectedTier={economyFilter} singlePlayer={singlePlayer} showHeading={showHeading} />
          )} />
        </div>
      )}
      {sub === 'flair' && (
        <GroupedOrFlat aggregated={aggregated} groups={teamGroups} render={(agg) => (
          <FlairTable aggregated={agg} kills={kills} singlePlayer={singlePlayer} showHeading={showHeading} />
        )} />
      )}
      {sub === 'trades' && (
        <GroupedOrFlat aggregated={aggregated} groups={teamGroups} render={(agg) => (
          <TradesTable aggregated={agg} singlePlayer={singlePlayer} showHeading={showHeading} />
        )} />
      )}
      {sub === 'utility' && (
        <GroupedOrFlat aggregated={aggregated} groups={teamGroups} render={(agg) => (
          <UtilityTable aggregated={agg} singlePlayer={singlePlayer} showHeading={showHeading} />
        )} />
      )}
      {sub === 'sides' && (
        <div className="space-y-6">
          <PerSideStatsTable perSideStats={perSideStats} />
          <div className="flex items-center gap-4">
            <Checkbox checked={includeCT} onToggle={() => setIncludeCT((v) => !v)} label="CT" />
            <Checkbox checked={includeT} onToggle={() => setIncludeT((v) => !v)} label="T" />
          </div>
          <GroupedOrFlat aggregated={aggregated} groups={teamGroups} render={(agg) => (
            <SideSplitTable aggregated={agg} includeCT={includeCT} includeT={includeT} showHeading={showHeading} />
          )} />
        </div>
      )}
      {sub === 'plus' && showPlusStats && <PlusStatsTable aggregated={aggregated} />}
    </div>
  );
}
