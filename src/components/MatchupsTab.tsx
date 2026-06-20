'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { winRatePct, tabCls } from '@/lib/util';
import type { H2HData } from '@/lib/queries';
import { duoBlendedScorer, duoBreakdownScorer, rivalBlendedScorer, rivalBreakdownScorer } from '@/lib/queries';
import PlayerAvatar from './PlayerAvatar';
import RatingCircle from './RatingCircle';

type H2HSortCol = 'name' | 'rating' | 'wl' | 'games' | 'wr' | 'rwr' | 'kills' | 'assists' | 'deaths' | 'kd' | 'adr';
type B2BSortCol = 'name' | 'rating' | 'wl' | 'games' | 'wr' | 'rwr' | 'kills' | 'assists' | 'deaths' | 'kd' | 'adr';
type MatchupsSubTab = 'h2h' | 'b2b';

function rowBg(rating: number, color: string) {
  return `color-mix(in srgb, ${color} ${Math.round(3 + (rating / 100) * 15)}%, var(--color-bg-primary))`;
}
function rowHoverBg(rating: number, color: string) {
  return `color-mix(in srgb, ${color} ${Math.round(8 + (rating / 100) * 15)}%, var(--color-bg-primary))`;
}

function SortableTh({
  label,
  col,
  active,
  asc,
  align = 'right',
  title,
  onClick,
}: {
  label: string;
  col: string;
  active: string;
  asc: boolean;
  align?: 'left' | 'right' | 'center';
  title?: string;
  onClick: (c: string) => void;
}) {
  const isActive = active === col;
  return (
    <th
      tabIndex={0}
      title={title}
      onClick={() => onClick(col)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(col); } }}
      className={`tracked text-[10px] font-semibold py-2.5 px-2 border-b border-[var(--color-border-primary)] cursor-pointer select-none whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)] text-${align} ${
        isActive ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'
      }`}
    >
      {label}
      {isActive && <span className="ml-1">{asc ? '↑' : '↓'}</span>}
    </th>
  );
}

function CalloutCard({
  label,
  player,
  stat,
  color,
  title,
}: {
  label: string;
  player: { id: number; name: string; steam_avatar_url: string | null } | undefined;
  stat: string;
  color: string;
  title?: string;
}) {
  if (!player) return null;
  return (
    <Link
      href={`/players/${player.id}`}
      title={title}
      className="lift-row border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-4 py-3 flex items-center gap-3 transition-colors"
      style={{ background: `color-mix(in srgb, ${color} 6%, var(--color-bg-primary))` }}
    >
      <PlayerAvatar name={player.name} imageUrl={player.steam_avatar_url} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="tracked text-[9px] text-[var(--color-text-secondary)] mb-0.5 whitespace-nowrap">{label}</div>
        <div className="font-display font-semibold text-[13px] truncate">{player.name}</div>
      </div>
      <div className="display-numeral text-[18px] font-semibold shrink-0" style={{ color }}>{stat}</div>
    </Link>
  );
}

export default function MatchupsTab({ playerId, h2hData }: { playerId: number; h2hData: H2HData }) {
  const [subTab, setSubTab] = useState<MatchupsSubTab>('h2h');
  const [h2hSort, setH2hSort] = useState<H2HSortCol>('rating');
  const [h2hAsc, setH2hAsc] = useState(false);
  const [b2bSort, setB2bSort] = useState<B2BSortCol>('rating');
  const [b2bAsc, setB2bAsc] = useState(false);

  const playersById = useMemo(() => {
    const m = new Map<number, (typeof h2hData.players)[number]>();
    for (const p of h2hData.players) m.set(p.id, p);
    return m;
  }, [h2hData.players]);

  // League-wide scorer closures for normalization (same as Statistics page)
  const rivalScore = useMemo(() => rivalBlendedScorer(h2hData.rivals), [h2hData.rivals]);
  const rivalBreakdown = useMemo(() => rivalBreakdownScorer(h2hData.rivals), [h2hData.rivals]);
  const duoScore = useMemo(() => duoBlendedScorer(h2hData.duos), [h2hData.duos]);
  const duoBreakdown = useMemo(() => duoBreakdownScorer(h2hData.duos), [h2hData.duos]);

  // ── H2H rows (this player as opponent) ───────────────────────────────────
  const h2hRows = useMemo(
    () =>
      h2hData.rivals
        .filter((r) => r.playerA === playerId || r.playerB === playerId)
        .filter((r) => r.meetings > 0)
        .map((r) => {
          const isA = r.playerA === playerId;
          const other = isA ? r.playerB : r.playerA;
          const myStats = isA ? r.aStats : r.bStats;
          const myWins = isA ? r.aWins : r.bWins;
          const myLosses = isA ? r.bWins : r.aWins;
          const games = myWins + myLosses;
          const wr = winRatePct(myWins, games);
          const kd = myStats.deaths > 0 ? myStats.kills / myStats.deaths : myStats.kills;
          return {
            other,
            myWins,
            myLosses,
            games,
            wr,
            roundsWon: myStats.roundsWon,
            roundsPlayed: myStats.roundsPlayed,
            rwr: winRatePct(myStats.roundsWon, myStats.roundsPlayed),
            kills: myStats.kills,
            assists: myStats.assists,
            deaths: myStats.deaths,
            kd,
            adr: myStats.adr,
            _raw: r,
          };
        }),
    [h2hData.rivals, playerId],
  );

  // ── B2B rows (this player as teammate) ───────────────────────────────────
  const b2bRows = useMemo(
    () =>
      h2hData.duos
        .filter((d) => d.playerA === playerId || d.playerB === playerId)
        .filter((d) => d.gamesPlayed > 0)
        .map((d) => {
          const other = d.playerA === playerId ? d.playerB : d.playerA;
          const myStats    = d.playerA === playerId ? d.aStats : d.bStats;
          const theirStats = d.playerA === playerId ? d.bStats : d.aStats;
          const kd = d.combinedDeaths > 0 ? d.combinedKills / d.combinedDeaths : d.combinedKills;
          return {
            other,
            wins: d.wins,
            losses: d.losses,
            games: d.gamesPlayed,
            wr: winRatePct(d.wins, d.gamesPlayed),
            roundsWon: d.roundsWon,
            roundsPlayed: d.roundsPlayed,
            rwr: winRatePct(d.roundsWon, d.roundsPlayed),
            kills: d.combinedKills,
            assists: d.combinedAssists,
            deaths: d.combinedDeaths,
            kd,
            adr: d.combinedAdr,
            myStats,
            theirStats,
            _raw: d,
          };
        }),
    [h2hData.duos, playerId],
  );

  // ── Callout card data ─────────────────────────────────────────────────────
  const { highestOutputPartner, mostElevatedPartner, bestFormOpponent, hotStreakRival } = useMemo(() => {
    // Teammate where this player's personal ADR was highest
    const byMyAdr = [...b2bRows].sort((a, b) => b.myStats.adr - a.myStats.adr);
    const topMyAdr = byMyAdr[0];

    // Teammate whose own ADR peaked when paired with this player (skip same player as above)
    const byTheirAdr = [...b2bRows].sort((a, b) => b.theirStats.adr - a.theirStats.adr);
    const topTheirAdr = byTheirAdr[0]?.other === topMyAdr?.other ? byTheirAdr[1] : byTheirAdr[0];

    // Opponent where this player's personal ADR was highest
    const byMyOppAdr = [...h2hRows].sort((a, b) => b.adr - a.adr);

    // Opponent against whom this player has the longest current win streak (matches are most-recent-first)
    const withStreak = h2hRows.map((row) => {
      const isA = row._raw.playerA === playerId;
      let streak = 0;
      for (const m of row._raw.matches) {
        if (m.aWon === null) continue;
        if (isA ? m.aWon : !m.aWon) streak++;
        else break;
      }
      return { row, streak };
    });
    const topStreak = withStreak.filter((s) => s.streak >= 2).sort((a, b) => b.streak - a.streak)[0];

    return {
      highestOutputPartner: topMyAdr ? { player: playersById.get(topMyAdr.other), stat: `${topMyAdr.myStats.adr.toFixed(1)}` } : null,
      mostElevatedPartner: topTheirAdr ? { player: playersById.get(topTheirAdr.other), stat: `${topTheirAdr.theirStats.adr.toFixed(1)}` } : null,
      bestFormOpponent: byMyOppAdr[0] ? { player: playersById.get(byMyOppAdr[0].other), stat: `${byMyOppAdr[0].adr.toFixed(1)}` } : null,
      hotStreakRival: topStreak ? { player: playersById.get(topStreak.row.other), stat: `${topStreak.streak}W` } : null,
    };
  }, [b2bRows, h2hRows, playersById, playerId]);

  // ── Sorting ───────────────────────────────────────────────────────────────
  const sortedH2h = useMemo(() => {
    const cmp = (a: (typeof h2hRows)[number], b: (typeof h2hRows)[number]): number => {
      switch (h2hSort) {
        case 'name':    return (playersById.get(a.other)?.name ?? '').localeCompare(playersById.get(b.other)?.name ?? '');
        case 'rating':  return rivalScore(b._raw) - rivalScore(a._raw);
        case 'wl':      return b.myWins - a.myWins || a.myLosses - b.myLosses;
        case 'games':   return b.games - a.games;
        case 'wr':      return b.wr - a.wr;
        case 'rwr':     return b.rwr - a.rwr;
        case 'kills':   return b.kills - a.kills;
        case 'assists': return b.assists - a.assists;
        case 'deaths':  return a.deaths - b.deaths;
        case 'kd':      return b.kd - a.kd;
        case 'adr':     return b.adr - a.adr;
      }
    };
    return [...h2hRows].sort((a, b) => h2hAsc ? -cmp(a, b) : cmp(a, b));
  }, [h2hRows, h2hSort, h2hAsc, playersById, rivalScore]);

  const sortedB2b = useMemo(() => {
    const cmp = (a: (typeof b2bRows)[number], b: (typeof b2bRows)[number]): number => {
      switch (b2bSort) {
        case 'name':    return (playersById.get(a.other)?.name ?? '').localeCompare(playersById.get(b.other)?.name ?? '');
        case 'rating':  return duoScore(b._raw) - duoScore(a._raw);
        case 'wl':      return b.wins - a.wins || a.losses - b.losses;
        case 'games':   return b.games - a.games;
        case 'wr':      return b.wr - a.wr;
        case 'rwr':     return b.rwr - a.rwr;
        case 'kills':   return b.kills - a.kills;
        case 'assists': return b.assists - a.assists;
        case 'deaths':  return a.deaths - b.deaths;
        case 'kd':      return b.kd - a.kd;
        case 'adr':     return b.adr - a.adr;
      }
    };
    return [...b2bRows].sort((a, b) => b2bAsc ? -cmp(a, b) : cmp(a, b));
  }, [b2bRows, b2bSort, b2bAsc, playersById, duoScore]);

  function clickH2hSort(col: string) {
    const c = col as H2HSortCol;
    if (c === h2hSort) setH2hAsc(!h2hAsc);
    else { setH2hSort(c); setH2hAsc(c === 'name'); }
  }

  function clickB2bSort(col: string) {
    const c = col as B2BSortCol;
    if (c === b2bSort) setB2bAsc(!b2bAsc);
    else { setB2bSort(c); setB2bAsc(c === 'name'); }
  }

  const GREEN = 'var(--color-accent-green-fg)';
  const RED   = 'var(--color-accent-red-fg)';

  const hasData = h2hRows.length > 0 || b2bRows.length > 0;
  if (!hasData) {
    return <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">No matchup data yet.</div>;
  }

  const H2H_COLS: { col: H2HSortCol; label: string; title?: string; align?: 'left' | 'right' | 'center' }[] = [
    { col: 'rating',  label: 'Rating', align: 'center' },
    { col: 'wl',      label: 'W-L' },
    { col: 'games',   label: 'Games' },
    { col: 'wr',      label: 'WR%' },
    { col: 'rwr',     label: 'RWR%' },
    { col: 'kills',   label: 'Kills' },
    { col: 'assists', label: 'Assists' },
    { col: 'deaths',  label: 'Deaths' },
    { col: 'kd',      label: 'K/D' },
    { col: 'adr',     label: 'ADR' },
  ];

  const B2B_COLS: { col: B2BSortCol; label: string; title?: string; align?: 'left' | 'right' | 'center' }[] = [
    { col: 'rating',  label: 'Rating', align: 'center' },
    { col: 'wl',      label: 'W-L' },
    { col: 'games',   label: 'Games' },
    { col: 'wr',      label: 'WR%' },
    { col: 'rwr',     label: 'RWR%' },
    { col: 'kills',   label: 'Comb. K',  title: 'Combined Kills' },
    { col: 'assists', label: 'Comb. A',  title: 'Combined Assists' },
    { col: 'deaths',  label: 'Comb. D',  title: 'Combined Deaths' },
    { col: 'kd',      label: 'Comb. K/D', title: 'Combined K/D' },
    { col: 'adr',     label: 'Comb. ADR', title: 'Combined ADR (both players per game)' },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Callout cards */}
      {(highestOutputPartner || mostElevatedPartner || bestFormOpponent || hotStreakRival) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {highestOutputPartner?.player && (
            <CalloutCard
              label="Highest Output"
              player={highestOutputPartner.player}
              stat={`${highestOutputPartner.stat} ADR`}
              color={GREEN}
              title="Teammate you've posted your highest personal ADR alongside"
            />
          )}
          {mostElevatedPartner?.player && (
            <CalloutCard
              label="Most Elevated"
              player={mostElevatedPartner.player}
              stat={`${mostElevatedPartner.stat} ADR`}
              color={GREEN}
              title="Teammate who was highest above their personal average ADR"
            />
          )}
          {bestFormOpponent?.player && (
            <CalloutCard
              label="Best Form vs"
              player={bestFormOpponent.player}
              stat={`${bestFormOpponent.stat} ADR`}
              color={GREEN}
              title="Your peak ADR in any rivalry"
            />
          )}
          {hotStreakRival?.player && (
            <CalloutCard
              label="Hot Streak vs"
              player={hotStreakRival.player}
              stat={hotStreakRival.stat}
              color="var(--color-site-accent)"
              title="Opponent you're currently on your longest active win streak against"
            />
          )}
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex gap-0 border-b border-[var(--color-border-primary)]">
        <button onClick={() => setSubTab('h2h')} className={tabCls(subTab === 'h2h')}>
          Rivals{h2hRows.length > 0 ? ` (${h2hRows.length})` : ''}
        </button>
        <button onClick={() => setSubTab('b2b')} className={tabCls(subTab === 'b2b')}>
          Friends{b2bRows.length > 0 ? ` (${b2bRows.length})` : ''}
        </button>
      </div>

      {/* H2H table */}
      {subTab === 'h2h' && (
        h2hRows.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">No opponent data yet.</div>
        ) : (
          <div className="bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-[13px]">
              <thead>
                <tr className="bg-[var(--color-bg-secondary)]">
                  <th className="sticky-col tracked text-[10px] font-semibold text-[var(--color-text-secondary)] text-left pl-4 pr-2 py-2.5 border-b border-[var(--color-border-primary)] whitespace-nowrap">
                    Opponent
                  </th>
                  {H2H_COLS.map(({ col, label, align, title }) => (
                    <SortableTh key={col} col={col} label={label} active={h2hSort} asc={h2hAsc} align={align} title={title} onClick={clickH2hSort} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedH2h.map((row) => {
                  const p = playersById.get(row.other);
                  if (!p) return null;
                  const rating = Math.round(rivalScore(row._raw) * 100);
                  const bg = rowBg(rating, RED);
                  const hoverBg = rowHoverBg(rating, RED);
                  return (
                    <tr
                      key={row.other}
                      className="border-b border-[var(--color-border-tertiary)] last:border-b-0 cursor-pointer transition-colors"
                      style={{ background: bg }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = hoverBg; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = bg; }}
                    >
                      <td className="sticky-col pl-4 pr-2 py-2.5">
                        <Link href={`/players/${p.id}`} className="flex items-center gap-2 w-full h-full">
                          <PlayerAvatar name={p.name} imageUrl={p.steam_avatar_url} size="sm" />
                          <span className="font-display font-semibold text-[13px] truncate">{p.name}</span>
                        </Link>
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <Link href={`/players/${p.id}`} className="flex justify-center">
                          <RatingCircle value={rating} colorStart="black" colorEnd={RED} size="xs" title={rivalBreakdown(row._raw)} />
                        </Link>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tnum">
                        <Link href={`/players/${p.id}`} className="block">{row.myWins}–{row.myLosses}</Link>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tnum">
                        <Link href={`/players/${p.id}`} className="block">{row.games}</Link>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tnum font-semibold">
                        <Link href={`/players/${p.id}`} className="block">{row.wr.toFixed(1)}%</Link>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tnum">
                        <Link href={`/players/${p.id}`} className="block">{row.rwr.toFixed(1)}%</Link>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tnum">
                        <Link href={`/players/${p.id}`} className="block">{row.kills}</Link>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tnum">
                        <Link href={`/players/${p.id}`} className="block">{row.assists}</Link>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tnum">
                        <Link href={`/players/${p.id}`} className="block">{row.deaths}</Link>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tnum">
                        <Link href={`/players/${p.id}`} className="block">{row.kd.toFixed(2)}</Link>
                      </td>
                      <td className="py-2.5 pr-4 pl-2 text-right font-mono tnum font-semibold">
                        <Link href={`/players/${p.id}`} className="block">{row.adr.toFixed(2)}</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* B2B table */}
      {subTab === 'b2b' && (
        b2bRows.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">No teammate data yet.</div>
        ) : (
          <div className="bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-[13px]">
              <thead>
                <tr className="bg-[var(--color-bg-secondary)]">
                  <th className="sticky-col tracked text-[10px] font-semibold text-[var(--color-text-secondary)] text-left pl-4 pr-2 py-2.5 border-b border-[var(--color-border-primary)] whitespace-nowrap">
                    Teammate
                  </th>
                  {B2B_COLS.map(({ col, label, align, title }) => (
                    <SortableTh key={col} col={col} label={label} active={b2bSort} asc={b2bAsc} align={align} title={title} onClick={clickB2bSort} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedB2b.map((row) => {
                  const p = playersById.get(row.other);
                  if (!p) return null;
                  const myName = playersById.get(playerId)?.name ?? 'Me';
                  const rating = Math.round(duoScore(row._raw) * 100);
                  const bg = rowBg(rating, GREEN);
                  const hoverBg = rowHoverBg(rating, GREEN);
                  const myKd = row.myStats.deaths > 0 ? row.myStats.kills / row.myStats.deaths : row.myStats.kills;
                  const theirKd = row.theirStats.deaths > 0 ? row.theirStats.kills / row.theirStats.deaths : row.theirStats.kills;
                  return (
                    <tr
                      key={row.other}
                      className="border-b border-[var(--color-border-tertiary)] last:border-b-0 cursor-pointer transition-colors"
                      style={{ background: bg }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = hoverBg; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = bg; }}
                    >
                      <td className="sticky-col pl-4 pr-2 py-2.5">
                        <Link href={`/players/${p.id}`} className="flex items-center gap-2 w-full h-full">
                          <PlayerAvatar name={p.name} imageUrl={p.steam_avatar_url} size="sm" />
                          <span className="font-display font-semibold text-[13px] truncate">{p.name}</span>
                        </Link>
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <Link href={`/players/${p.id}`} className="flex justify-center">
                          <RatingCircle value={rating} colorStart="black" colorEnd={GREEN} size="xs" title={duoBreakdown(row._raw)} />
                        </Link>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tnum">
                        <Link href={`/players/${p.id}`} className="block">{row.wins}–{row.losses}</Link>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tnum">
                        <Link href={`/players/${p.id}`} className="block">{row.games}</Link>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tnum font-semibold">
                        <Link href={`/players/${p.id}`} className="block">{row.wr.toFixed(1)}%</Link>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tnum">
                        <Link href={`/players/${p.id}`} className="block">{row.rwr.toFixed(1)}%</Link>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tnum" title={`${myName}: ${row.myStats.kills}\n${p.name}: ${row.theirStats.kills}`}>
                        <Link href={`/players/${p.id}`} className="block">{row.kills}</Link>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tnum" title={`${myName}: ${row.myStats.assists}\n${p.name}: ${row.theirStats.assists}`}>
                        <Link href={`/players/${p.id}`} className="block">{row.assists}</Link>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tnum" title={`${myName}: ${row.myStats.deaths}\n${p.name}: ${row.theirStats.deaths}`}>
                        <Link href={`/players/${p.id}`} className="block">{row.deaths}</Link>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tnum" title={`${myName}: ${myKd.toFixed(2)}\n${p.name}: ${theirKd.toFixed(2)}`}>
                        <Link href={`/players/${p.id}`} className="block">{row.kd.toFixed(2)}</Link>
                      </td>
                      <td className="py-2.5 pr-4 pl-2 text-right font-mono tnum font-semibold" title={`${myName}: ${row.myStats.adr.toFixed(1)}\n${p.name}: ${row.theirStats.adr.toFixed(1)}`}>
                        <Link href={`/players/${p.id}`} className="block">{row.adr.toFixed(2)}</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
