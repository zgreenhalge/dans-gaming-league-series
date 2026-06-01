'use client';

import { useState, useTransition, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

export interface ResultPlayer {
  player_id: number;
  player_name: string;
  faction: 'SHIRTS' | 'SKINS';
}

interface PlayerDraft {
  kills: string;
  assists: string;
  deaths: string;
  damage: string;
  adr: string;
}

function emptyDraft(): PlayerDraft {
  return { kills: '', assists: '', deaths: '', damage: '', adr: '' };
}

function intVal(s: string): number {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function floatVal(s: string): number | null {
  if (s.trim() === '') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

interface Props {
  matchId: number;
  players: ResultPlayer[];
  isAdmin: boolean;
  alreadyPlayed: boolean;
  targetWinRounds: number;
  skinsSide: 'CT' | 'T' | null;
}

export default function EnterResultsModal({
  matchId,
  players,
  isAdmin,
  alreadyPlayed,
  targetWinRounds,
  skinsSide,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [shirtsScore, setShirtsScore] = useState('');
  const [skinsScore, setSkinsScore] = useState('');
  const [drafts, setDrafts] = useState<Record<number, PlayerDraft>>(() =>
    Object.fromEntries(players.map((p) => [p.player_id, emptyDraft()])),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return null;
  if (alreadyPlayed && !isAdmin) return null;

  const shirtsPlayers = players.filter((p) => p.faction === 'SHIRTS');
  const skinsPlayers = players.filter((p) => p.faction === 'SKINS');

  // CT/T faction CSS classes — shirts is the opposite of skinsSide
  const shirtsFactionCls = skinsSide === 'CT' ? 'faction-t' : skinsSide === 'T' ? 'faction-ct' : '';
  const skinsFactionCls  = skinsSide === 'CT' ? 'faction-ct' : skinsSide === 'T' ? 'faction-t' : '';
  const shirtsSideLabel  = skinsSide === 'CT' ? 'T' : skinsSide === 'T' ? 'CT' : null;
  const skinsSideLabel   = skinsSide ?? null;

  // Computed rounds for ADR placeholder
  const shirtsInt = parseInt(shirtsScore, 10);
  const skinsInt  = parseInt(skinsScore, 10);
  const roundsPlayed =
    Number.isFinite(shirtsInt) && Number.isFinite(skinsInt) && shirtsInt >= 0 && skinsInt >= 0
      ? shirtsInt + skinsInt
      : 0;

  function computedAdrPlaceholder(d: PlayerDraft): string {
    if (d.damage === '' || roundsPlayed === 0) return 'auto';
    const dmg = intVal(d.damage);
    return (dmg / roundsPlayed).toFixed(1);
  }

  function updateDraft(playerId: number, field: keyof PlayerDraft, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [playerId]: { ...prev[playerId], [field]: value },
    }));
  }

  function handleOpen() {
    setShirtsScore('');
    setSkinsScore('');
    setDrafts(Object.fromEntries(players.map((p) => [p.player_id, emptyDraft()])));
    setError(null);
    setOpen(true);
  }

  function handleClose() {
    if (isPending) return;
    setOpen(false);
    setError(null);
  }

  async function handleSubmit() {
    setError(null);

    const sInt = parseInt(shirtsScore, 10);
    const skInt = parseInt(skinsScore, 10);
    if (!Number.isFinite(sInt) || sInt < 0 || !Number.isFinite(skInt) || skInt < 0) {
      setError('Enter valid scores for both teams.');
      return;
    }
    if (Math.max(sInt, skInt) < targetWinRounds) {
      setError(`At least one team must reach ${targetWinRounds} rounds to win.`);
      return;
    }

    const player_stats = players.map((p) => {
      const d = drafts[p.player_id];
      const adrVal = floatVal(d.adr);
      return {
        player_id: p.player_id,
        kills: intVal(d.kills),
        assists: intVal(d.assists),
        deaths: intVal(d.deaths),
        damage: intVal(d.damage),
        ...(adrVal != null ? { adr: adrVal } : {}),
      };
    });

    startTransition(async () => {
      const res = await fetch(`/api/matches/${matchId}/score`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shirts: sInt, skins: skInt, player_stats }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? 'Something went wrong.');
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const trigger = alreadyPlayed ? (
    <button
      onClick={handleOpen}
      className="tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors"
    >
      Edit Results
    </button>
  ) : (
    <button
      onClick={handleOpen}
      className="tracked text-[10px] font-semibold px-2 py-1.5 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:opacity-80 transition-opacity"
    >
      Enter Results
    </button>
  );

  const factionTable = (
    faction: 'SHIRTS' | 'SKINS',
    fPlayers: ResultPlayer[],
    factionCls: string,
    sideLabel: string | null,
  ) => (
    <div key={faction}>
      <div className={`tracked text-[10px] mb-2 flex items-center gap-1.5 ${factionCls} faction-fg`}>
        {faction}
        {sideLabel && (
          <span className="opacity-60 font-normal normal-case tracking-normal">{sideLabel}</span>
        )}
      </div>
      <div className={`border border-[var(--color-border-primary)] overflow-hidden faction-tint ${factionCls}`}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-[var(--color-bg-secondary)]">
              <th className="tracked text-[9px] font-semibold text-[var(--color-text-secondary)] text-left pl-3 pr-2 py-2 border-b border-[var(--color-border-primary)]">
                Player
              </th>
              {['K', 'A', 'D', 'DMG'].map((h) => (
                <th key={h} className="tracked text-[9px] font-semibold text-[var(--color-text-secondary)] text-center px-1.5 py-2 border-b border-[var(--color-border-primary)] w-14">
                  {h}
                </th>
              ))}
              <th className="tracked text-[9px] font-semibold text-[var(--color-text-secondary)] text-center px-1.5 py-2 border-b border-[var(--color-border-primary)] w-16">
                ADR
                <span className="ml-0.5 font-normal opacity-60">(opt)</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {fPlayers.map((p) => {
              const d = drafts[p.player_id];
              const adrPlaceholder = computedAdrPlaceholder(d);
              return (
                <tr key={p.player_id} className="border-b border-[var(--color-border-tertiary)] last:border-b-0">
                  <td className="pl-3 pr-2 py-1.5 font-display font-semibold text-[var(--color-text-primary)] whitespace-nowrap">
                    {p.player_name}
                  </td>
                  {(['kills', 'assists', 'deaths', 'damage'] as const).map((field) => (
                    <td key={field} className="px-1 py-1.5 text-center">
                      <input
                        type="number"
                        min={0}
                        value={d[field]}
                        onChange={(e) => updateDraft(p.player_id, field, e.target.value)}
                        placeholder="0"
                        className="w-12 px-1 py-1 font-mono text-[12px] text-center border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1.5 text-center">
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={d.adr}
                      onChange={(e) => updateDraft(p.player_id, 'adr', e.target.value)}
                      placeholder={adrPlaceholder}
                      className="w-14 px-1 py-1 font-mono text-[12px] text-center border border-[var(--color-border-tertiary)] border-dashed bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-text-secondary)] focus:border-solid"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <>
      {trigger}
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
          >
            <div className="bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border-primary)]">
                <h2 className="font-display font-bold text-[16px] text-[var(--color-text-primary)]">
                  {alreadyPlayed ? 'Edit Results' : 'Enter Results'}
                </h2>
                <button
                  onClick={handleClose}
                  disabled={isPending}
                  className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors text-[18px] leading-none"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="px-5 py-4 flex flex-col gap-6">
                {/* Score row */}
                <div>
                  <div className="tracked text-[10px] text-[var(--color-text-secondary)] mb-2">Final Score</div>
                  <div className="flex items-center gap-3">
                    <div className={`flex flex-col gap-1 ${shirtsFactionCls}`}>
                      <label className="tracked text-[9px] faction-fg">Shirts</label>
                      <input
                        type="number"
                        min={0}
                        value={shirtsScore}
                        onChange={(e) => setShirtsScore(e.target.value)}
                        placeholder="0"
                        className="w-16 px-2 py-1.5 font-mono text-[15px] text-center border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
                      />
                    </div>
                    <span className="font-mono text-[18px] text-[var(--color-text-secondary)] mt-4">—</span>
                    <div className={`flex flex-col gap-1 ${skinsFactionCls}`}>
                      <label className="tracked text-[9px] faction-fg">Skins</label>
                      <input
                        type="number"
                        min={0}
                        value={skinsScore}
                        onChange={(e) => setSkinsScore(e.target.value)}
                        placeholder="0"
                        className="w-16 px-2 py-1.5 font-mono text-[15px] text-center border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
                      />
                    </div>
                  </div>
                </div>

                {factionTable('SHIRTS', shirtsPlayers, shirtsFactionCls, shirtsSideLabel)}
                {factionTable('SKINS', skinsPlayers, skinsFactionCls, skinsSideLabel)}

                {error && (
                  <p className="text-[12px] text-[var(--color-accent-red-fg,#ef4444)]">{error}</p>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={isPending}
                  className="w-full py-2 tracked text-[11px] font-semibold border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-80 transition-opacity"
                >
                  {isPending ? 'Saving…' : alreadyPlayed ? 'Save Changes' : 'Submit Results'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
