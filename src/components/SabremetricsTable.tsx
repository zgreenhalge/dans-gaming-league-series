'use client';

import type { SabFields } from '@/lib/types';

interface PlayerSabRow {
  player_id: number;
  player_name: string;
  faction: 'SHIRTS' | 'SKINS';
  rounds_played: number;
  sabremetrics: SabFields;
}

export interface SabremetricsTableProps {
  players: PlayerSabRow[];
}

const thCls =
  'tracked text-[10px] font-semibold text-[var(--color-text-secondary)] text-right px-3 py-2.5 border-b border-[var(--color-border-primary)] whitespace-nowrap';
const tdCls = 'px-3 py-2.5 text-right font-mono tnum text-[13px]';

function pct(num: number, den: number): string {
  if (den === 0) return '—';
  return `${Math.round((num / den) * 100)}%`;
}

export default function SabremetricsTable({ players }: SabremetricsTableProps) {
  if (players.length === 0) return null;

  const cols = [
    { header: 'Player', key: 'name', title: '' },
    { header: 'HS%', key: 'hs_pct', title: 'Headshot kill percentage' },
    { header: 'Entry', key: 'entry', title: 'Opening duel wins-losses' },
    { header: 'KAST', key: 'kast', title: 'Rounds with a Kill, Assist, Survived, or Traded' },
    { header: '2K', key: 'two_k', title: 'Rounds where both opponents were eliminated' },
    { header: 'Clutch', key: 'clutch', title: 'Clutch wins / attempts (1v1 + 1v2)' },
    { header: 'EF', key: 'ef', title: 'Enemy players blinded by flashbangs' },
    { header: 'UD', key: 'ud', title: 'Damage dealt with grenades' },
    { header: 'PL', key: 'pl', title: 'Bomb plants' },
    { header: 'DF', key: 'df', title: 'Bomb defuses' },
  ];

  function cellValue(p: PlayerSabRow, key: string): React.ReactNode {
    const s = p.sabremetrics;
    switch (key) {
      case 'name':
        return p.player_name;
      case 'hs_pct': {
        const k = s.kills_ct + s.kills_t;
        return pct(s.headshot_kills, k);
      }
      case 'entry':
        return (
          <span>
            <span className="text-[var(--color-accent-green-fg)]">{s.opening_kills}</span>
            <span className="text-[var(--color-text-secondary)]">-</span>
            <span className="text-[var(--color-accent-red-fg)]">{s.opening_deaths}</span>
          </span>
        );
      case 'kast':
        return pct(s.kast_rounds, p.rounds_played);
      case 'two_k':
        return s.two_k_rounds;
      case 'clutch':
        return `${s.clutch_1v1_wins + s.clutch_1v2_wins}/${s.clutch_1v1_attempts + s.clutch_1v2_attempts}`;
      case 'ef':
        return s.enemies_flashed;
      case 'ud':
        return s.utility_damage;
      case 'pl':
        return s.plants;
      case 'df':
        return s.defuses;
      default:
        return '—';
    }
  }

  return (
    <div className="border border-[var(--color-border-primary)] overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-[13px]">
        <thead>
          <tr className="bg-[var(--color-bg-secondary)]">
            {cols.map((col) => (
              <th
                key={col.key}
                title={col.title || undefined}
                className={
                  col.key === 'name'
                    ? 'tracked text-[10px] font-semibold text-[var(--color-text-secondary)] text-left pl-4 pr-3 py-2.5 border-b border-[var(--color-border-primary)]'
                    : thCls
                }
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr
              key={p.player_id}
              className="border-b border-[var(--color-border-tertiary)] last:border-b-0"
            >
              {cols.map((col, i) => (
                <td
                  key={col.key}
                  className={
                    col.key === 'name'
                      ? 'pl-4 pr-3 py-2.5 font-display font-semibold text-[var(--color-text-primary)]'
                      : i === cols.length - 1
                        ? `${tdCls} pr-4 font-semibold`
                        : tdCls
                  }
                >
                  {cellValue(p, col.key)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
