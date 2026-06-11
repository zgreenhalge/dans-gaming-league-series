'use client';

import Link from 'next/link';
import type { DuoStats, H2HStats } from '@/lib/queries';
import { rateGradientColor, winRatePct } from '@/lib/util';
import { mapImageFor, mapSlug, toSentenceCase } from '@/lib/maps';
import PlayerAvatar from './PlayerAvatar';
import RatingCircle from './RatingCircle';

type H2HPlayer = { id: number; name: string; steam_avatar_url: string | null };

function StatCell({ label, children, color }: { label: string; children: React.ReactNode; color?: string }) {
  return (
    <div className="border-l-2 border-[var(--color-border-primary)] pl-2.5">
      <div className="tracked text-[8px] text-[var(--color-text-secondary)]">{label}</div>
      <div className="font-display text-[16px] font-bold mt-1" style={color ? { color } : undefined}>
        {children}
      </div>
    </div>
  );
}

function RecycleButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="inline-flex items-center justify-center w-5 h-5 shrink-0 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[10px] leading-none text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-secondary)] transition-colors"
    >
      ↺
    </button>
  );
}

/** Three right-aligned, fixed-width numeric columns — keeps K/A/D figures lined up across rows (and under a header). */
function StatTrio({ values, color }: { values: [React.ReactNode, React.ReactNode, React.ReactNode]; color?: string }) {
  return (
    <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums" style={{ color }}>
      {values.map((v, i) => (
        <span key={i} className="w-[20px] text-right">{v}</span>
      ))}
    </div>
  );
}

/** Compact "S{season}[G] W/R{week} M{match}" reference label for a match-history row. */
function matchRefLabel(seasonNumber: number | null, isGauntlet: boolean, weekNumber: number, matchNumber: number): string {
  const sLabel = seasonNumber != null ? `S${seasonNumber}${isGauntlet ? 'G' : ''}` : null;
  const wLabel = `${isGauntlet ? 'R' : 'W'}${weekNumber}·M${matchNumber}`;
  return sLabel ? `${sLabel}·${wLabel}` : wLabel;
}

function MatchHistoryRow({
  matchId,
  matchLabel,
  labelColor = 'var(--color-text-secondary)',
  map,
  mapColor = 'var(--color-ct)',
  scoreLabel,
  scoreColor,
  scorePosition = 'right',
  resultLabel,
  resultColor,
  rightContent,
}: {
  matchId: number;
  matchLabel: string;
  labelColor?: string;
  map: string | null;
  mapColor?: string;
  scoreLabel: string | null;
  scoreColor?: string;
  scorePosition?: 'left' | 'right';
  resultLabel?: string | null;
  resultColor?: string;
  rightContent: React.ReactNode;
}) {
  const score = scoreLabel ? (
    <span className="display-numeral text-[12px] whitespace-nowrap" style={{ color: scoreColor }}>{scoreLabel}</span>
  ) : (
    <span className="tracked text-[8px] text-[var(--color-accent-amber-fg)] whitespace-nowrap">TBD</span>
  );

  return (
    <Link
      href={`/matches/${matchId}`}
      className="lift-row flex items-center gap-2 py-2 px-1 -mx-1 border-b border-[var(--color-border-tertiary)] last:border-b-0 transition-colors"
    >
      <div className="flex items-center gap-1 shrink-0">
        <span className="font-mono text-[10px] w-[52px] shrink-0" style={{ color: labelColor }}>{matchLabel}</span>
        {scorePosition === 'left' && <div className="w-[36px] shrink-0 whitespace-nowrap text-center">{score}</div>}
      </div>
      <span
        className={`font-mono text-[11px] w-[48px] shrink-0 truncate capitalize ${scorePosition === 'left' ? 'ml-1.5' : ''}`}
        style={{ color: mapColor }}
      >
        {map ?? '—'}
      </span>
      <div className="flex-1 min-w-0 flex items-center gap-1.5">{rightContent}</div>
      {scorePosition === 'right' && score}
      {resultLabel != null && (
        <span className="tracked text-[7px] font-bold w-[18px] text-center" style={{ color: resultColor }}>
          {resultLabel}
        </span>
      )}
    </Link>
  );
}

export function DuoDetail({
  duo,
  players,
  onFlip,
  minimal,
  headerLabel,
  headerColor,
  statsHref,
  friendshipRating,
  ratingBreakdown,
}: {
  duo: DuoStats;
  players: Map<number, H2HPlayer>;
  onFlip?: () => void;
  minimal?: boolean;
  headerLabel?: string;
  headerColor?: string;
  statsHref?: string;
  friendshipRating?: number;
  ratingBreakdown?: string;
}) {
  const a = players.get(duo.playerA);
  const b = players.get(duo.playerB);
  if (!a || !b) return null;

  const circleValue = friendshipRating ?? winRatePct(duo.wins, duo.gamesPlayed);
  const mapImg = mapImageFor(duo.bestMap);

  const hero = (
    <>
      <RatingCircle value={circleValue} colorStart="white" colorEnd="var(--color-accent-green-fill)" size="lg" title={ratingBreakdown ?? "50% games played together² · 30% win rate² · 20% round win rate²"} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center">
          <PlayerAvatar name={a.name} imageUrl={a.steam_avatar_url} size="md" />
          <div className="-ml-2.5">
            <PlayerAvatar name={b.name} imageUrl={b.steam_avatar_url} size="md" />
          </div>
          <span className="font-display font-bold text-[17px] ml-2.5 truncate">{a.name} &amp; {b.name}</span>
        </div>
        <div
          className={`font-mono text-[10px] mt-1 truncate ${duo.bestMap ? '' : 'invisible'}`}
          style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)', color: 'rgba(255,255,255,0.7)' }}
        >
          Best on{' '}
          {duo.bestMap ? (
            <Link
              href={`/maps/${mapSlug(duo.bestMap)}`}
              className="capitalize hover:underline relative z-[2]"
              style={{ color: 'var(--color-ct)' }}
            >
              {toSentenceCase(duo.bestMap)}
            </Link>
          ) : '—'}
        </div>
      </div>
    </>
  );

  return (
    <div className={`border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]${minimal && statsHref ? ' relative cursor-pointer lift-card' : ''}`}>
      {minimal && statsHref && <Link href={statsHref} className="absolute inset-0 z-[1]" aria-label="View in H2H statistics" />}
      <div className="px-5 py-2.5 border-b border-[var(--color-border-tertiary)] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {onFlip && <RecycleButton onClick={onFlip} title="View this pair as rivals" />}
          <span
            className="tracked text-[12px]"
            style={{ color: headerColor ?? 'var(--color-accent-green-fg)' }}
          >
            {headerLabel ?? 'Friend'}
          </span>
        </div>
      </div>
      <div className="p-4">
        <div
          className={`relative overflow-hidden border border-[var(--color-border-primary)] no-hover-ring ${mapImg ? 'map-card-bg' : ''}`}
          style={mapImg ? { ['--map-img' as string]: `url("${mapImg}")` } : undefined}
        >
          {mapImg && (
            <div
              className="absolute inset-0 z-[1]"
              style={{ background: 'radial-gradient(circle at 50% 40%, rgba(10,13,18,0.35), rgba(8,11,16,0.85))' }}
            />
          )}
          <div className="relative z-[2] flex items-center gap-3.5 px-3.5 py-4">{hero}</div>
        </div>

        <div className="grid grid-cols-3 gap-2.5 mt-4">
          <StatCell label="Record" color={duo.wins >= duo.losses ? 'var(--color-accent-green-fg)' : 'var(--color-accent-red-fg)'}>
            {duo.wins}–{duo.losses}
          </StatCell>
          <StatCell label="Rounds" color={rateGradientColor(winRatePct(duo.roundsWon, duo.roundsPlayed))}>
            {duo.roundsWon}–{duo.roundsPlayed - duo.roundsWon}
          </StatCell>
          <StatCell label="Comb. ADR">{duo.combinedAdr.toFixed(1)}</StatCell>
        </div>

        <div className="grid grid-cols-3 gap-2.5 mt-2.5">
          <StatCell label="Comb. Kills">{duo.combinedKills}</StatCell>
          <StatCell label="Comb. Assists">{duo.combinedAssists}</StatCell>
          <StatCell label="Comb. Deaths">{duo.combinedDeaths}</StatCell>
        </div>

        {!minimal && duo.matches.length > 0 && (
          <div className="mt-3.5 pt-2.5 border-t border-[var(--color-border-primary)]">
            {duo.matches.map((m) => {
              const scoreLabel = m.score ? `${m.score.duo}–${m.score.opponents}` : null;
              const resultColor = m.won ? 'var(--color-accent-green-fg)' : 'var(--color-accent-red-fg)';
              return (
                <MatchHistoryRow
                  key={m.matchId}
                  matchId={m.matchId}
                  matchLabel={matchRefLabel(m.seasonNumber, m.isGauntlet, m.weekNumber, m.matchNumber)}
                  labelColor="var(--color-text-primary)"
                  map={m.map}
                  mapColor="var(--color-text-primary)"
                  scoreLabel={scoreLabel}
                  scoreColor={resultColor}
                  scorePosition="left"
                  rightContent={
                    <>
                      <span className="tracked text-[8px] text-[var(--color-text-secondary)] mr-1">vs</span>
                      <div className="flex -space-x-1.5">
                        {m.opponents.map((o) => (
                          <PlayerAvatar key={o.player_id} name={o.player_name} imageUrl={null} size="sm" />
                        ))}
                      </div>
                      <span className="font-display font-semibold text-[10px] truncate ml-1">
                        {m.opponents.map((o) => o.player_name).join(' & ')}
                      </span>
                    </>
                  }
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function H2HStatPair({ aValue, bValue }: { aValue: string; bValue: string }) {
  return (
    <span>
      <span style={{ color: 'var(--color-t)' }}>{aValue}</span>
      <span className="text-[12px] font-normal text-[var(--color-text-secondary)] mx-1">–</span>
      <span style={{ color: 'var(--color-ct)' }}>{bValue}</span>
    </span>
  );
}

function kdr(stats: H2HStats['aStats']): number {
  return stats.deaths > 0 ? stats.kills / stats.deaths : stats.kills;
}

function H2HStatsGrid({ rival }: { rival: H2HStats }) {
  return (
    <>
      <div className="grid grid-cols-3 gap-2.5 mt-4">
        <StatCell label="RWR%">
          <H2HStatPair aValue={`${rival.aStats.rwr.toFixed(1)}%`} bValue={`${rival.bStats.rwr.toFixed(1)}%`} />
        </StatCell>
        <StatCell label="KDR">
          <H2HStatPair aValue={kdr(rival.aStats).toFixed(2)} bValue={kdr(rival.bStats).toFixed(2)} />
        </StatCell>
        <StatCell label="ADR">
          <H2HStatPair aValue={rival.aStats.adr.toFixed(0)} bValue={rival.bStats.adr.toFixed(0)} />
        </StatCell>
      </div>
    </>
  );
}

export function RivalDetail({
  rival,
  players,
  onFlip,
  minimal,
  statsHref,
  rivalryRating,
  ratingBreakdown,
}: {
  rival: H2HStats;
  players: Map<number, H2HPlayer>;
  onFlip?: () => void;
  minimal?: boolean;
  statsHref?: string;
  rivalryRating?: number;
  ratingBreakdown?: string;
}) {
  const a = players.get(rival.playerA);
  const b = players.get(rival.playerB);
  if (!a || !b) return null;

  const total = rival.aWins + rival.bWins || 1;
  const mapImg = mapImageFor(rival.lastMap);

  const circleValue = rivalryRating ?? 50;
  const rivalCircle = <RatingCircle value={circleValue} colorStart="black" colorEnd="var(--color-accent-red-fg)" size="lg" title={ratingBreakdown ?? "50% times faced² · 30% game outcome closeness² · 20% avg round closeness²"} />;

  const scoreBars = (
    <div className="flex h-8 overflow-hidden">
      <div className="flex items-center justify-center" style={{ width: `${(rival.aWins / total) * 100}%`, background: 'var(--color-t)' }}>
        {rival.aWins > 0 && (
          <span className="display-numeral text-[20px] font-black text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
            {rival.aWins}
          </span>
        )}
      </div>
      <div className="flex items-center justify-center flex-1" style={{ background: 'var(--color-ct)' }}>
        {rival.bWins > 0 && (
          <span className="display-numeral text-[20px] font-black text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
            {rival.bWins}
          </span>
        )}
      </div>
    </div>
  );

  const nameStyle = (color: string): React.CSSProperties => ({ color, WebkitTextStroke: '1px black', paintOrder: 'stroke fill' });
  const smCol = 'w-[24px] text-right font-mono text-[11px] tabular-nums shrink-0';
  const lgCol = 'w-[32px] text-right font-mono text-[11px] tabular-nums shrink-0';
  const smHdr = 'w-[24px] text-right tracked text-[8px] text-[var(--color-text-secondary)] shrink-0';
  const lgHdr = 'w-[32px] text-right tracked text-[8px] text-[var(--color-text-secondary)] shrink-0';

  const statsTable = (
    <div className="border-t border-[var(--color-border-primary)] pt-1">
      <div className="flex items-center gap-2 py-1">
        <span className="flex-1" />
        <span className={smHdr}>K</span>
        <span className={smHdr}>A</span>
        <span className={smHdr}>D</span>
        <span className={lgHdr}>ADR</span>
        <span className={lgHdr}>KDR</span>
        <span className={lgHdr}>RWR%</span>
      </div>
      {([
        { player: a, stats: rival.aStats, color: 'var(--color-t)' },
        { player: b, stats: rival.bStats, color: 'var(--color-ct)' },
      ] as const).map(({ player, stats, color }) => (
        <Link key={player.id} href={`/players/${player.id}`} className="lift-row relative z-[2] flex items-center gap-2 py-1.5 border-t border-[var(--color-border-tertiary)]">
          <span className="ml-2 shrink-0"><PlayerAvatar name={player.name} imageUrl={player.steam_avatar_url} size="sm" /></span>
          <span className="flex-1 font-display font-semibold text-[12px] truncate" style={{ color }}>{player.name}</span>
          <span className={smCol}>{stats.kills}</span>
          <span className={smCol}>{stats.assists}</span>
          <span className={smCol}>{stats.deaths}</span>
          <span className={lgCol}>{stats.adr.toFixed(0)}</span>
          <span className={lgCol}>{kdr(stats).toFixed(2)}</span>
          <span className={lgCol}>{stats.rwr.toFixed(1)}%</span>
        </Link>
      ))}
    </div>
  );

  if (minimal) {
    return (
      <div className={`border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]${statsHref ? ' relative cursor-pointer lift-card' : ''}`}>
        {statsHref && <Link href={statsHref} className="absolute inset-0 z-[1]" aria-label="View in H2H statistics" />}
        <div className="px-4 pt-3.5 pb-1">
          <div className="flex items-center gap-3 mb-2">
            <span className="flex-1 font-display font-bold text-[13px] truncate" style={nameStyle('var(--color-t)')}>{a.name}</span>
            {rivalCircle}
            <span className="flex-1 font-display font-bold text-[13px] truncate text-right" style={nameStyle('var(--color-ct)')}>{b.name}</span>
          </div>
          <div className="mb-3">{scoreBars}</div>
          {statsTable}
        </div>
      </div>
    );
  }

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <div className="px-5 py-2.5 border-b border-[var(--color-border-tertiary)] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {onFlip && <RecycleButton onClick={onFlip} title="View this pair as friends" />}
          <span className="tracked text-[12px] text-[var(--color-t)]">Rival</span>
        </div>
      </div>
      <div className="p-4">
        <div
          className={`relative overflow-hidden border border-[var(--color-border-primary)] no-hover-ring ${mapImg ? 'map-card-bg' : ''}`}
          style={mapImg ? { ['--map-img' as string]: `url("${mapImg}")` } : undefined}
        >
          {mapImg && (
            <div className="absolute inset-0 z-[1]" style={{ background: 'radial-gradient(circle at 50% 40%, rgba(10,13,18,0.35), rgba(8,11,16,0.85))' }} />
          )}
          <div className="relative z-[2] flex items-center gap-3 px-3.5 py-4">
            <span className="flex-1 font-display font-bold text-[14px] truncate" style={nameStyle('var(--color-t)')}>{a.name}</span>
            {rivalCircle}
            <span className="flex-1 font-display font-bold text-[14px] truncate text-right" style={nameStyle('var(--color-ct)')}>{b.name}</span>
          </div>
          <div className="relative z-[2]">{scoreBars}</div>
        </div>

        <div className="mt-3.5">{statsTable}</div>

        {rival.meetings > 0 && (
          <div className="mt-3.5 pt-2.5 border-t border-[var(--color-border-primary)]">
            {rival.matches.map((m) => {
              const scoreLabel = m.score ? `${m.score.a}–${m.score.b}` : null;
              const scoreColor = m.aWon == null ? undefined : m.aWon ? 'var(--color-t)' : 'var(--color-ct)';
              return (
                <MatchHistoryRow
                  key={m.matchId}
                  matchId={m.matchId}
                  matchLabel={matchRefLabel(m.seasonNumber, m.isGauntlet, m.weekNumber, m.matchNumber)}
                  labelColor="var(--color-text-primary)"
                  map={m.map}
                  mapColor="var(--color-text-primary)"
                  scoreLabel={scoreLabel}
                  scoreColor={scoreColor}
                  scorePosition="left"
                  rightContent={
                    <div className="w-full flex items-center justify-end gap-5">
                      <StatTrio
                        values={[m.aMatchStats.kills, m.aMatchStats.assists, m.aMatchStats.deaths]}
                        color="var(--color-t)"
                      />
                      <StatTrio
                        values={[m.bMatchStats.kills, m.bMatchStats.assists, m.bMatchStats.deaths]}
                        color="var(--color-ct)"
                      />
                    </div>
                  }
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
