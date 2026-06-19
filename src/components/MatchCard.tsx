import Link from 'next/link';
import { LocalTime } from './LocalTime';
import { PlayerName } from './PlayerName';
import { mapImageFor, toSentenceCase } from '@/lib/maps';
import { fmtWindowDate, formatEhogDelta } from '@/lib/util';
import { CountdownTimer } from './CountdownTimer';
import { FeatureMatchIcon } from './FeatureMatch';

export interface MatchCardPlayer {
  player_id: number;
  player_name: string;
  kills: number;
  assists: number;
  deaths: number;
  adr: number;
}

export type MatchCardLabel =
  | { type: 'match'; matchNumber: number; isFeatureMatch: boolean }
  | { type: 'game'; gameNumber: number }
  | { type: 'player-history'; seasonNumber: number | null; isGauntlet: boolean; weekNumber: number; matchNumber: number };

export type MatchCardRight =
  | { type: 'score'; score: string }
  | { type: 'scheduled'; scheduledAt: string }
  | { type: 'week-window'; weekStart: Date; weekEnd: Date }
  | { type: 'pending' }
  | null;

interface MatchCardProps {
  href: string;
  map?: string | null;
  label: MatchCardLabel;
  right: MatchCardRight;
  /** Colors the card border on standalone variant. */
  outcome?: 'win' | 'loss' | null;
  shirtsStats?: MatchCardPlayer[] | null;
  skinsStats?: MatchCardPlayer[] | null;
  shirtsFallback?: string;
  skinsFallback?: string;
  currentPlayerId?: number | null;
  /** Enlarge/bold the current player's stat row. Enable only on the player profile page. */
  highlightCurrentPlayer?: boolean;
  /** When set, highlights this player's name (accent glow) independently of currentPlayerId. */
  loggedInPlayerId?: number | null;
  /** EHOG rating deltas per player_id for this match. */
  ehogDeltas?: Record<number, number> | null;
  /** 'inline': inside a container block (border-b style). 'standalone': full-border card. */
  containerVariant?: 'inline' | 'standalone';
}

function TeamStatBlock({
  players,
  currentPlayerId,
  highlightCurrentPlayer,
  loggedInPlayerId,
  ehogDeltas,
}: {
  players: MatchCardPlayer[];
  currentPlayerId: number | null;
  highlightCurrentPlayer: boolean;
  loggedInPlayerId: number | null;
  ehogDeltas?: Record<number, number> | null;
}) {
  const statCls = `font-mono tnum text-right shrink-0`;
  const hdrCls = `text-[11px] font-semibold text-[var(--color-text-secondary)] text-right shrink-0`;
  const showEhog = ehogDeltas != null && Object.keys(ehogDeltas).length > 0;

  return (
    <div className="px-3 py-2">
      {/* header */}
      <div className="flex items-center pl-2 pb-1">
        <span className="flex-1" />
        <span className={`${hdrCls} w-7 sm:w-9`}>K</span>
        <span className={`${hdrCls} w-7 sm:w-9 hidden min-[480px]:block`}>A</span>
        <span className={`${hdrCls} w-7 sm:w-9`}>D</span>
        <span className={`${hdrCls} w-12 sm:w-14 ${showEhog ? '' : 'pr-2'}`}>ADR</span>
        {showEhog && <span className="w-14 pr-2 hidden min-[480px]:block" />}
      </div>
      {/* rows */}
      <div className="divide-y divide-[var(--color-border-tertiary)]">
      {players.map((p) => {
        const isPagePlayer = currentPlayerId !== null && p.player_id === currentPlayerId;
        const highlight = isPagePlayer && highlightCurrentPlayer;
        const meId = loggedInPlayerId ?? currentPlayerId;
        const isMe = meId !== null && p.player_id === meId;
        const numSz = highlight ? 'text-[12px] font-semibold' : 'text-[11px]';
        return (
          <div key={p.player_id} className={`flex items-center py-0.5 ${highlight ? 'current-player-row' : ''}`}>
            <span className={`font-display flex items-center flex-1 min-w-0 pl-2 pr-1 ${highlight ? 'text-[15px] lg:text-[16px] font-semibold' : 'text-[13px] font-semibold'}`}>
              <span className="truncate"><PlayerName name={p.player_name} isMe={isMe} /></span>
            </span>
            <span className={`${statCls} ${numSz} w-7 sm:w-9 text-[var(--color-text-primary)]`}>{p.kills}</span>
            <span className={`${statCls} ${numSz} w-7 sm:w-9 text-[var(--color-text-primary)] hidden min-[480px]:block`}>{p.assists}</span>
            <span className={`${statCls} ${numSz} w-7 sm:w-9 text-[var(--color-text-primary)]`}>{p.deaths}</span>
            <span className={`${statCls} ${numSz} w-12 sm:w-14 ${showEhog ? '' : 'pr-2'} text-[var(--color-text-primary)]`}>{Math.round(p.adr)}</span>
            {showEhog && (() => {
              const delta = ehogDeltas[p.player_id] as number | undefined;
              return (
                <span className={`${statCls} ${highlight ? 'text-[12px] font-semibold' : 'text-[11px]'} w-14 pr-2 hidden min-[480px]:block ${delta != null ? (delta >= 0 ? 'text-[var(--color-accent-green-fg)]' : 'text-[var(--color-accent-red-fg)]') : 'text-[var(--color-text-secondary)]'}`}>
                  {delta != null ? formatEhogDelta(delta) : ''}
                </span>
              );
            })()}
          </div>
        );
      })}
      </div>
    </div>
  );
}

function renderLabel(label: MatchCardLabel, map: string | null | undefined) {
  const mapLabel = map ? (
    <span className="tracked text-[11px] font-semibold text-[var(--color-text-secondary)] map-head">
      {toSentenceCase(map)}
    </span>
  ) : null;

  if (label.type === 'match') {
    return (
      <div className="flex items-baseline gap-3">
        <span className="font-display text-[18px] font-semibold text-[var(--color-text-primary)] map-head">
          Match {label.matchNumber} {label.isFeatureMatch && <FeatureMatchIcon />}
        </span>
        {mapLabel}
      </div>
    );
  }

  if (label.type === 'game') {
    return (
      <div className="flex items-baseline gap-3">
        <span className="font-display text-[18px] font-semibold text-[var(--color-text-primary)] map-head">
          Game {label.gameNumber}
        </span>
        {mapLabel}
      </div>
    );
  }

  // player-history
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-display text-[18px] font-semibold text-[var(--color-text-primary)] map-head">
        {label.seasonNumber != null ? `S${label.seasonNumber}${label.isGauntlet ? 'G' : ''} · ` : ''}{label.isGauntlet ? 'R' : 'W'}{label.weekNumber} · M{label.matchNumber}
      </span>
      {mapLabel}
    </div>
  );
}

function renderRight(right: MatchCardRight) {
  if (!right) return null;

  switch (right.type) {
    case 'score':
      return (
        <span className="font-mono text-[13px] font-semibold tnum text-[var(--color-text-primary)]">
          {right.score}
        </span>
      );
    case 'scheduled':
      return (
        <div className="text-right">
          <div className="font-mono text-[12px] text-[var(--color-text-primary)]">
            <LocalTime iso={right.scheduledAt} opts={{ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }} />
          </div>
          <CountdownTimer iso={right.scheduledAt} className="tracked text-[9px] text-[var(--color-text-secondary)] mt-0.5" />
        </div>
      );
    case 'week-window':
      return (
        <span className="tracked text-[10px] text-[var(--color-text-secondary)]">
          {fmtWindowDate(right.weekStart)} – {fmtWindowDate(right.weekEnd)}
        </span>
      );
    case 'pending':
      return (
        <span className="tracked text-[9px] font-semibold text-[var(--color-accent-amber-fg)]">
          Pending
        </span>
      );
  }
}

function outcomeBorderColor(outcome: 'win' | 'loss' | null | undefined): string | undefined {
  if (outcome === 'win') return 'var(--color-accent-green-border)';
  if (outcome === 'loss') return 'var(--color-accent-red-border)';
  return undefined;
}

export function MatchCard({
  href,
  map,
  label,
  right,
  outcome,
  shirtsStats,
  skinsStats,
  shirtsFallback,
  skinsFallback,
  currentPlayerId = null,
  highlightCurrentPlayer = false,
  loggedInPlayerId = null,
  ehogDeltas,
  containerVariant = 'inline',
}: MatchCardProps) {
  const mapImg = mapImageFor(map);
  const hasStats = (shirtsStats?.length ?? 0) > 0 || (skinsStats?.length ?? 0) > 0;
  const hasFallback = !!(shirtsFallback || skinsFallback);
  const borderColor = containerVariant === 'standalone' ? outcomeBorderColor(outcome) : undefined;

  const containerCls =
    containerVariant === 'standalone'
      ? `lift-card block transition-colors ${borderColor ? 'border-2' : 'border border-[var(--color-border-primary)]'} ${mapImg ? 'map-card-bg' : 'hover:bg-[var(--color-bg-secondary)]'}`
      : `block border-b border-[var(--color-border-tertiary)] last:border-b-0 transition-colors ${mapImg ? 'map-card-bg' : 'lift-row'}`;

  const containerStyle: React.CSSProperties = {
    ...(mapImg ? { ['--map-img' as string]: `url("${mapImg}")` } : {}),
    // Win/loss cards carry a meaningful border color — keep it on hover via
    // `--lift-accent` instead of letting `.lift-card` replace it with the site accent.
    ...(borderColor ? { borderColor, ['--lift-accent' as string]: borderColor } : {}),
  };

  return (
    <Link
      href={href}
      className={containerCls}
      style={Object.keys(containerStyle).length > 0 ? containerStyle : undefined}
    >
      <div className={mapImg ? 'bg-[var(--overlay-strong)] hover:bg-[var(--overlay-medium)] transition-colors' : ''}>
        <div className="px-4 py-2 flex items-center justify-between gap-4 border-b border-[var(--color-border-tertiary)]">
          {renderLabel(label, map)}
          {renderRight(right)}
        </div>

        {hasStats ? (
          <div className="px-4 py-3">
            <div className="grid grid-cols-2 divide-x divide-[var(--color-border-tertiary)]">
              <TeamStatBlock
                players={shirtsStats ?? []}
                currentPlayerId={currentPlayerId}
                highlightCurrentPlayer={highlightCurrentPlayer}
                loggedInPlayerId={loggedInPlayerId}
                ehogDeltas={ehogDeltas}
              />
              <TeamStatBlock
                players={skinsStats ?? []}
                currentPlayerId={currentPlayerId}
                highlightCurrentPlayer={highlightCurrentPlayer}
                loggedInPlayerId={loggedInPlayerId}
                ehogDeltas={ehogDeltas}
              />
            </div>
          </div>
        ) : hasFallback ? (
          <div className="px-4 py-3 font-mono text-[11px] text-[var(--color-text-secondary)] truncate map-head">
            {shirtsFallback ?? 'Shirts TBD'} <span className="opacity-50 map-head">vs</span> {skinsFallback ?? 'Skins TBD'}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
