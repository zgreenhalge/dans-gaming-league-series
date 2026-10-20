import Link from 'next/link';
import { h2hPairHref } from '@/lib/crumbs';
import { toSentenceCase } from '@/lib/maps';
import type { MyStats, MyStatsPlayer } from '@/lib/queries';
import EmptyState from './EmptyState';
import { ehogColorFor } from './EhogBadge';
import { NextMatchLink } from './NextMatchLink';
import { WLChip } from './WLChip';
import { PlayerName } from './PlayerName';
import { PanelLink } from './PanelHeader';
import StatTileGrid from './StatTileGrid';

const LABEL_CLS = 'tracked text-[10px] text-[var(--color-text-secondary)]';
const PANEL_CLS = 'border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] p-5';
const PANEL_STYLE = { borderTopColor: 'var(--color-site-accent)', borderTopWidth: '3px' };

function H2HRow({
  label,
  labelColor,
  other,
  href,
}: {
  label: string;
  labelColor: string;
  other: MyStatsPlayer;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="lift-row flex items-center justify-between gap-3 px-2 py-2 border-b border-[var(--color-border-tertiary)] last:border-b-0"
    >
      <span className="text-[13px]" style={{ color: labelColor }}>{label}</span>
      <span className="font-display font-semibold text-[14px] truncate">
        {other.name} <span className="font-mono text-[12px] text-[var(--color-text-secondary)]">{other.wins}-{other.losses}</span>
      </span>
    </Link>
  );
}

/**
 * The home page's My Stats panel for a signed-in player: EHOG, W-L, KDA and ADR, their next
 * match, best friend and worst nightmare (each linking to the career H2H matchup), and their last
 * played matches. `stats` comes from `getMyStats()` (`src/lib/queries/myStats.ts`).
 */
export function MyStatsPanel({ stats }: { stats: MyStats }) {
  const { playerId, playerName, ehog, record, kda, kd, adr, next, recent, bestFriend, worstNightmare } = stats;
  const played = record.wins + record.losses > 0;

  return (
    <div className={PANEL_CLS} style={PANEL_STYLE}>
      <div className={LABEL_CLS}>My Stats</div>
      <Link href={`/players/${playerId}`} className="inline-block font-display text-[28px] font-bold mt-1 mb-3 hover:opacity-80 transition-opacity">
        <PlayerName name={playerName} isMe />
      </Link>
      <StatTileGrid
        columns="grid-cols-4"
        tiles={[
          {
            label: 'EHOG',
            title: 'Current EHOG rating',
            value: ehog != null ? ehog.toFixed(1) : '—',
            valueStyle: ehog != null ? { color: ehogColorFor(ehog) } : undefined,
          },
          { label: 'W-L', title: 'Career match record', value: played ? `${record.wins}-${record.losses}` : '—' },
          {
            label: 'KDA',
            title: 'Career (kills + assists) per death; K/D is kills per death',
            value: played ? kda.toFixed(2) : '—',
            sub: played ? `${kd.toFixed(2)} K/D` : undefined,
          },
          { label: 'ADR', title: 'Career average damage per round', value: played ? adr.toFixed(2) : '—' },
        ]}
      />

      {next && (
        <NextMatchLink className="mt-4" {...next} />
      )}

      {(bestFriend || worstNightmare) && (
        <div className="mt-4 border-t border-[var(--color-border-secondary)] pt-2">
          {bestFriend && (
            <H2HRow
              label="Best friend"
              labelColor="var(--color-accent-green-fg)"
              other={bestFriend}
              href={h2hPairHref('/statistics', playerName, bestFriend.name, 'partner')}
            />
          )}
          {worstNightmare && (
            <H2HRow
              label="Worst nightmare"
              labelColor="var(--color-accent-amber-fg)"
              other={worstNightmare}
              href={h2hPairHref('/statistics', playerName, worstNightmare.name, 'opponent')}
            />
          )}
        </div>
      )}

      <div className="mt-4 border-t border-[var(--color-border-secondary)] pt-3">
        <div className="flex items-baseline justify-between mb-2">
          <span className={LABEL_CLS}>Match history</span>
          <PanelLink href={`/players/${playerId}?tab=matches`}>View all →</PanelLink>
        </div>
        {recent.length === 0 ? (
          <EmptyState message="No recent matches" />
        ) : (
          recent.map((m) => (
            <Link
              key={m.matchId}
              href={`/matches/${m.matchId}`}
              className="lift-row flex items-center gap-3 px-2 py-2 border-b border-[var(--color-border-tertiary)] last:border-b-0"
            >
              <WLChip won={m.won} />
              <span className="font-mono text-[12px] w-12 shrink-0">{m.score}</span>
              <span className="text-[12px] truncate flex-1 min-w-0">vs {m.opponents}</span>
              {m.map && <span className="font-mono text-[11px] text-[var(--color-text-secondary)] shrink-0">{toSentenceCase(m.map)}</span>}
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * The signed-out stand-in for `MyStatsPanel`: a blurred placeholder of what a signed-in player
 * sees, with a Login prompt over it. The placeholder is static — no league data sits behind the blur.
 */
export function MyStatsLockedPanel() {
  return (
    <div className={PANEL_CLS} style={PANEL_STYLE}>
      <div className={LABEL_CLS}>My Stats</div>
      <div className="select-none opacity-70 blur-[5px]" aria-hidden>
        <div className="font-display text-[28px] font-bold mt-1 mb-3">Your Name</div>
        <StatTileGrid
          columns="grid-cols-4"
          tiles={[
            { label: 'EHOG', value: '23.4' },
            { label: 'W-L', value: '11-9' },
            { label: 'KDA', value: '1.42' },
            { label: 'ADR', value: '74.05' },
          ]}
        />
        <div className="mt-4 flex flex-col gap-2 font-mono text-[12px]">
          <span>Best friend · Worst nightmare</span>
          <span>W 13-9 · W 13-6 · L 8-13</span>
        </div>
      </div>
      <div className="mt-4 flex flex-col items-start gap-2">
        <div className="font-display text-[17px] font-semibold">Login to see your stats</div>
        <div className="text-[13px] text-[var(--color-text-secondary)]">
          Your EHOG, KDA, next match, best friend, worst nightmare and match history.
        </div>
        {/* Intentionally a plain <a>, not next/link's <Link>: this route is a Route Handler that
            302s to steamcommunity.com for the OpenID flow, not an app page (see TopbarShell). */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/api/auth/steam"
          className="inline-block px-3.5 py-2 text-[13px] bg-[var(--color-text-primary)] text-[var(--color-bg-primary)] hover:opacity-85 transition-opacity"
        >
          Login
        </a>
      </div>
    </div>
  );
}
