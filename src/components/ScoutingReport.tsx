'use client';

import type { DuoStats, H2HStats, ScoutingPlayer } from '@/lib/queries';
import { duoBlendedScorer, rivalBlendedScorer } from '@/lib/queries';
import { toSentenceCase } from '@/lib/maps';
import { DuoDetail, RivalDetail } from './H2HDetail';

function h2hHref(nameA: string, nameB: string, type: 'partner' | 'opponent'): string {
  return `/statistics?tab=h2h&a=${encodeURIComponent(nameA)}&b=${encodeURIComponent(nameB)}&type=${type}`;
}

function findDuo(duos: DuoStats[], a: number, b: number): DuoStats | undefined {
  return duos.find((d) => (d.playerA === a && d.playerB === b) || (d.playerA === b && d.playerB === a));
}

function findRival(rivals: H2HStats[], a: number, b: number): H2HStats | undefined {
  return rivals.find((r) => (r.playerA === a && r.playerB === b) || (r.playerA === b && r.playerB === a));
}

function EmptyPanel({ label }: { label: string }) {
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] flex items-center justify-center p-8 min-h-[80px]">
      <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">{label}</span>
    </div>
  );
}

function MapIntelRow({ player, map }: { player: ScoutingPlayer; map: string }) {
  const mapAdr = player.mapAdr;
  if (mapAdr == null) {
    return (
      <div className="flex items-center gap-2.5 py-1.5 border-b border-[var(--color-border-tertiary)] last:border-b-0">
        <span className="font-display font-semibold text-[12px] w-[80px] truncate">{player.name}</span>
        <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">No data on {toSentenceCase(map)} yet</span>
      </div>
    );
  }
  const delta = mapAdr - player.adr;
  const barColor = delta >= 5 ? 'var(--color-accent-green-fg)' : delta <= -5 ? 'var(--color-accent-red-fg)' : 'var(--color-ct)';
  const deltaColor = delta >= 5 ? 'var(--color-accent-green-fg)' : delta <= -5 ? 'var(--color-accent-red-fg)' : 'var(--color-text-secondary)';

  return (
    <div className="flex items-center gap-2.5 py-1.5 border-b border-[var(--color-border-tertiary)] last:border-b-0">
      <span className="font-display font-semibold text-[12px] w-[80px] truncate">{player.name}</span>
      <span className="flex-1 block h-[5px] bg-[rgba(255,255,255,0.08)]">
        <span className="block h-full" style={{ width: `${Math.max(0, Math.min(100, (mapAdr / 130) * 100))}%`, background: barColor }} />
      </span>
      <span className="display-numeral text-[14px] w-[42px] text-right">{mapAdr.toFixed(0)}</span>
      <span className="font-mono text-[10px] w-[38px] text-right" style={{ color: deltaColor }}>
        {delta >= 0 ? '+' : ''}{delta.toFixed(0)}
      </span>
    </div>
  );
}

type Faction = 'CT' | 'T' | null;

function factionColor(f: Faction): string {
  if (f === 'T') return 'var(--color-t)';
  if (f === 'CT') return 'var(--color-ct)';
  return 'var(--color-text-secondary)';
}

export default function ScoutingReport({
  shirts,
  skins,
  duos,
  rivals,
  matchMap,
  shirtsF,
  skinsF,
}: {
  shirts: [ScoutingPlayer, ScoutingPlayer];
  skins: [ScoutingPlayer, ScoutingPlayer];
  duos: DuoStats[];
  rivals: H2HStats[];
  matchMap: string | null;
  shirtsF: Faction;
  skinsF: Faction;
}) {
  const allPlayers = [...shirts, ...skins];
  const playersById = new Map(allPlayers.map((p) => [p.id, p]));

  const shirtsDuo = findDuo(duos, shirts[0].id, shirts[1].id);
  const skinsDuo = findDuo(duos, skins[0].id, skins[1].id);
  const scoreDuo = duoBlendedScorer(duos);
  const scoreRival = rivalBlendedScorer(rivals);

  // columns = shirts[0], shirts[1] — rows = skins[0], skins[1]
  const rivalCells: Array<{ shirt: ScoutingPlayer; skin: ScoutingPlayer; rival: H2HStats | undefined }> = [
    { shirt: shirts[0], skin: skins[0], rival: findRival(rivals, shirts[0].id, skins[0].id) },
    { shirt: shirts[1], skin: skins[0], rival: findRival(rivals, shirts[1].id, skins[0].id) },
    { shirt: shirts[0], skin: skins[1], rival: findRival(rivals, shirts[0].id, skins[1].id) },
    { shirt: shirts[1], skin: skins[1], rival: findRival(rivals, shirts[1].id, skins[1].id) },
  ];

  return (
    <div className="mt-6">
      <div className="tracked text-[10px] mb-4" style={{ letterSpacing: '0.2em' }}>
        <span className="text-[var(--color-ct)]">Scouting Report</span>
        <span className="text-[var(--color-text-secondary)] mx-2">—</span>
        <span className="text-[var(--color-ct)]">Friends</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        {shirtsDuo
          ? <DuoDetail duo={shirtsDuo} players={playersById} minimal headerLabel="Shirts" headerColor={factionColor(shirtsF)} statsHref={h2hHref(shirts[0].name, shirts[1].name, 'partner')} friendshipRating={Math.round(scoreDuo(shirtsDuo) * 100)} />
          : <EmptyPanel label={`Shirts (${shirts[0].name} & ${shirts[1].name}) — no history yet`} />}
        {skinsDuo
          ? <DuoDetail duo={skinsDuo} players={playersById} minimal headerLabel="Skins" headerColor={factionColor(skinsF)} statsHref={h2hHref(skins[0].name, skins[1].name, 'partner')} friendshipRating={Math.round(scoreDuo(skinsDuo) * 100)} />
          : <EmptyPanel label={`Skins (${skins[0].name} & ${skins[1].name}) — no history yet`} />}
      </div>

      <div className="tracked text-[10px] mt-6 mb-4" style={{ letterSpacing: '0.2em' }}>
        <span className="text-[var(--color-t)]">Scouting Report</span>
        <span className="text-[var(--color-text-secondary)] mx-2">—</span>
        <span className="text-[var(--color-t)]">Rivals</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        {rivalCells.map(({ shirt, skin, rival }) =>
          rival ? (
            <RivalDetail key={`${rival.playerA}-${rival.playerB}`} rival={rival} players={playersById} minimal statsHref={h2hHref(shirt.name, skin.name, 'opponent')} rivalryRating={Math.round(scoreRival(rival) * 100)} />
          ) : (
            <EmptyPanel key={`${shirt.id}-${skin.id}`} label={`${shirt.name} vs ${skin.name} — no history yet`} />
          ),
        )}
      </div>

      {matchMap && (
        <div className="mt-5 border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
          <div className="px-4 py-2.5 border-b border-[var(--color-border-tertiary)] flex items-baseline justify-between gap-3">
            <span className="tracked text-[9px] text-[var(--color-text-secondary)]">
              Map Intel — <span className="capitalize text-[var(--color-text-primary)]">{toSentenceCase(matchMap)}</span>
            </span>
            <span className="tracked text-[8px] text-[var(--color-text-secondary)]">ADR vs avg</span>
          </div>
          <div className="px-4 pt-1 pb-2">
            {[...allPlayers]
              .sort((a, b) => (b.mapAdr ?? -1) - (a.mapAdr ?? -1))
              .map((p) => (
                <MapIntelRow key={p.id} player={p} map={matchMap} />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
