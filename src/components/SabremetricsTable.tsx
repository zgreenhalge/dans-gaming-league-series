import type { SabFieldsWithDerived } from '@/lib/types';
import Th from './Th';
import { StatTable, Tr, Td, NameTd } from './StatTable';

interface PlayerSabRow {
  player_id: number;
  player_name: string;
  faction: 'SHIRTS' | 'SKINS';
  rounds_played: number;
  sabremetrics: SabFieldsWithDerived;
}

export interface SabremetricsTableProps {
  players: PlayerSabRow[];
}

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
    { header: 'TK', key: 'tk', title: 'Teamkills' },
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
      case 'tk':
        return s.teamkills;
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
    <StatTable>
        <thead>
          <tr>
            {cols.map((col) => (
              <Th key={col.key} title={col.title || undefined} align={col.key === 'name' ? 'left' : 'right'} sticky={col.key === 'name'}>
                {col.header}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <Tr key={p.player_id}>
              {cols.map((col, i) =>
                col.key === 'name' ? (
                  <NameTd key={col.key} sticky>{cellValue(p, col.key)}</NameTd>
                ) : (
                  <Td key={col.key} bold={i === cols.length - 1}>{cellValue(p, col.key)}</Td>
                ),
              )}
            </Tr>
          ))}
        </tbody>
    </StatTable>
  );
}
