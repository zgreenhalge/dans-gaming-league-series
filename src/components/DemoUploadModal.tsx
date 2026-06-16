'use client';

import { useState, useTransition, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
type Faction = 'CT' | 'T' | null;

interface MatchPlayer {
  player_id: number;
  player_name: string;
  faction: 'SHIRTS' | 'SKINS';
}

interface PlayerStat {
  player_id: number;
  faction: 'SHIRTS' | 'SKINS';
  kills: number;
  assists: number;
  deaths: number;
  damage: number;
  rounds_played: number;
  rounds_won: number;
  adr: number;
  is_win: boolean;
}

interface ParsedResult {
  stats: PlayerStat[];
  shirts_score: number | null;
  skins_score: number | null;
  warnings: string[];
}

type DraftStats = Record<number, { kills: string; assists: string; deaths: string; damage: string }>;

type Stage = 'idle' | 'uploading' | 'parsing' | 'preview' | 'submitting';

function factionClass(faction: 'SHIRTS' | 'SKINS', skinsSide: Faction): string {
  if (!skinsSide) return '';
  const shirtsSide: Faction = skinsSide === 'CT' ? 'T' : 'CT';
  const side = faction === 'SHIRTS' ? shirtsSide : skinsSide;
  return side === 'CT' ? 'faction-ct' : 'faction-t';
}

function initDraftFromStats(stats: PlayerStat[]): DraftStats {
  const draft: DraftStats = {};
  for (const s of stats) {
    draft[s.player_id] = {
      kills: String(s.kills),
      assists: String(s.assists),
      deaths: String(s.deaths),
      damage: String(s.damage),
    };
  }
  return draft;
}

const statInputCls =
  'w-12 px-1 py-0.5 font-mono text-[11px] text-right border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-border-secondary)]';

interface Props {
  matchId: number;
  players: MatchPlayer[];
  skinsSide: 'CT' | 'T' | null;
  targetWinRounds: number;
  isAdmin: boolean;
  alreadyPlayed: boolean;
  initialStats?: PlayerStat[];
  initialShirtsScore?: number | null;
  initialSkinsScore?: number | null;
}

export default function DemoUploadModal({
  matchId,
  players,
  skinsSide,
  targetWinRounds,
  isAdmin,
  alreadyPlayed,
  initialStats,
  initialShirtsScore,
  initialSkinsScore,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [stage, setStage] = useState<Stage>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [parsed, setParsed] = useState<ParsedResult | null>(null);
  const [draftStats, setDraftStats] = useState<DraftStats>({});
  const [shirtsScore, setShirtsScore] = useState('');
  const [skinsScore, setSkinsScore] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return null;
  if (alreadyPlayed && !isAdmin) return null;

  function handleOpen() {
    setError(null);

    if (alreadyPlayed && initialStats && initialStats.length > 0) {
      // Edit mode: pre-populate from existing stats
      const syntheticParsed: ParsedResult = {
        stats: initialStats,
        shirts_score: initialShirtsScore ?? null,
        skins_score: initialSkinsScore ?? null,
        warnings: [],
      };
      setParsed(syntheticParsed);
      setDraftStats(initDraftFromStats(initialStats));
      setShirtsScore(initialShirtsScore != null ? String(initialShirtsScore) : '');
      setSkinsScore(initialSkinsScore != null ? String(initialSkinsScore) : '');
      setStage('preview');
    } else {
      setStage('idle');
      setUploadProgress(0);
      setParsed(null);
      setDraftStats({});
      setShirtsScore('');
      setSkinsScore('');
    }

    setOpen(true);
  }

  function handleClose() {
    if (stage === 'uploading' || stage === 'parsing' || stage === 'submitting') return;
    setOpen(false);
  }

  function updateDraft(playerId: number, field: keyof DraftStats[number], value: string) {
    setDraftStats((prev) => ({
      ...prev,
      [playerId]: { ...prev[playerId], [field]: value },
    }));
  }

  async function handleFileSelect(file: File) {
    if (!file.name.endsWith('.dem') && !file.name.endsWith('.dem.gz') && !file.name.endsWith('.gz')) {
      setError('Please select a CS2 demo file (.dem or .dem.gz).');
      return;
    }

    setError(null);
    setStage('uploading');
    setUploadProgress(0);

    // Step 1: get presigned upload URL
    const urlRes = await fetch(`/api/matches/${matchId}/demo/upload-url`, { method: 'POST' });
    if (!urlRes.ok) {
      const json = await urlRes.json().catch(() => ({}));
      setError(json.error ?? 'Failed to prepare upload.');
      setStage('idle');
      return;
    }
    const { signedUrl } = await urlRes.json();

    // Step 2: PUT file directly to R2 with progress tracking
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', signedUrl);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload failed: HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('Upload network error.'));
      xhr.send(file);
    }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Upload failed.');
      setStage('idle');
      return Promise.reject();
    });

    // Step 3: trigger server-side parsing
    setStage('parsing');
    const parseRes = await fetch(`/api/matches/${matchId}/demo/parse`, { method: 'POST' });
    if (!parseRes.ok) {
      const json = await parseRes.json().catch(() => ({}));
      setError(json.error ?? 'Demo parsing failed.');
      setStage('idle');
      return;
    }

    const result: ParsedResult = await parseRes.json();
    setParsed(result);
    setDraftStats(initDraftFromStats(result.stats));

    if (result.shirts_score !== null) setShirtsScore(String(result.shirts_score));
    if (result.skins_score !== null) setSkinsScore(String(result.skins_score));

    setStage('preview');
  }

  async function handleSubmit() {
    if (!parsed) return;

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

    const totalRounds = sInt + skInt;
    const player_stats = parsed.stats.map((s) => {
      const d = draftStats[s.player_id];
      const kills   = d ? (parseInt(d.kills,   10) || 0) : s.kills;
      const assists = d ? (parseInt(d.assists, 10) || 0) : s.assists;
      const deaths  = d ? (parseInt(d.deaths,  10) || 0) : s.deaths;
      const damage  = d ? (parseInt(d.damage,  10) || 0) : s.damage;
      const adr = totalRounds > 0 ? Math.round(damage / totalRounds) : 0;
      return { player_id: s.player_id, kills, assists, deaths, damage, adr };
    });

    setError(null);
    startTransition(async () => {
      setStage('submitting');
      const res = await fetch(`/api/matches/${matchId}/score`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shirts: sInt, skins: skInt, player_stats }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? 'Something went wrong.');
        setStage('preview');
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const shirtsPlayers = players.filter((p) => p.faction === 'SHIRTS');
  const skinsPlayers = players.filter((p) => p.faction === 'SKINS');
  const statMap = new Map((parsed?.stats ?? []).map((s) => [s.player_id, s]));

  const trigger = alreadyPlayed ? (
    <button
      onClick={handleOpen}
      className="tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors"
    >
      Edit
    </button>
  ) : (
    <button
      onClick={handleOpen}
      className="tracked text-[10px] font-semibold px-3 py-1.5 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:opacity-80 transition-opacity"
    >
      Upload Demo
    </button>
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
            <div className="bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-xl">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border-primary)]">
                <h2 className="font-display font-bold text-[16px] text-[var(--color-text-primary)]">
                  {alreadyPlayed ? 'Edit Results' : stage === 'preview' ? 'Review Results' : 'Upload Demo'}
                </h2>
                <button
                  onClick={handleClose}
                  disabled={stage === 'uploading' || stage === 'parsing' || stage === 'submitting'}
                  className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors text-[18px] leading-none disabled:opacity-40"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="px-5 py-5 flex flex-col gap-5">
                {/* Upload area — shown when idle */}
                {stage === 'idle' && (
                  <label className="flex flex-col items-center justify-center gap-3 px-6 py-10 border-2 border-dashed border-[var(--color-border-primary)] hover:border-[var(--color-border-secondary)] cursor-pointer transition-colors">
                    <input
                      type="file"
                      accept=".dem,.dem.gz,.gz"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFileSelect(f).catch(() => {});
                      }}
                    />
                    <span className="text-[32px] opacity-40">📁</span>
                    <div className="text-center">
                      <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                        Choose demo file
                      </p>
                      <p className="text-[11px] text-[var(--color-text-secondary)] mt-1">
                        .dem or .dem.gz — stats will be extracted automatically
                      </p>
                    </div>
                  </label>
                )}

                {/* Upload progress */}
                {stage === 'uploading' && (
                  <div className="flex flex-col gap-3">
                    <div className="tracked text-[10px] text-[var(--color-text-secondary)]">
                      Uploading demo…
                    </div>
                    <div className="h-1.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border-primary)] overflow-hidden">
                      <div
                        className="h-full bg-[var(--color-accent-green-fg)] transition-all duration-150"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                    <div className="text-[12px] font-mono text-[var(--color-text-secondary)]">
                      {uploadProgress}%
                    </div>
                  </div>
                )}

                {/* Parsing spinner */}
                {stage === 'parsing' && (
                  <div className="flex flex-col items-center gap-3 py-8">
                    <div className="w-6 h-6 border-2 border-[var(--color-border-primary)] border-t-[var(--color-accent-green-fg)] rounded-full animate-spin" />
                    <p className="text-[12px] text-[var(--color-text-secondary)]">
                      Analyzing demo…
                    </p>
                  </div>
                )}

                {/* Preview / Edit */}
                {(stage === 'preview' || stage === 'submitting') && parsed && (
                  <>
                    {/* Warnings */}
                    {parsed.warnings.length > 0 && (
                      <div className="flex flex-col gap-1 px-3 py-2.5 border border-[var(--color-accent-amber-pickborder)] bg-[color-mix(in_srgb,var(--color-accent-amber-pickborder)_8%,var(--color-bg-primary))]">
                        {parsed.warnings.map((w, i) => (
                          <p key={i} className="text-[11px] text-[var(--color-accent-amber-pickborder)]">
                            ⚠ {w}
                          </p>
                        ))}
                      </div>
                    )}

                    {/* Score */}
                    <div>
                      <div className="tracked text-[10px] text-[var(--color-text-secondary)] mb-2">
                        Final Score
                      </div>
                      <div className="flex items-center gap-3">
                        {(['SHIRTS', 'SKINS'] as const).map((faction) => {
                          const score = faction === 'SHIRTS' ? shirtsScore : skinsScore;
                          const setScore = faction === 'SHIRTS' ? setShirtsScore : setSkinsScore;
                          const cls = factionClass(faction, skinsSide);
                          return (
                            <div key={faction} className={`flex flex-col gap-1 ${cls}`}>
                              <label className="tracked text-[9px] faction-fg">
                                {faction}
                              </label>
                              <input
                                type="number"
                                min={0}
                                value={score}
                                onChange={(e) => setScore(e.target.value)}
                                className="w-16 px-2 py-1.5 font-mono text-[15px] text-center border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
                              />
                            </div>
                          );
                        })}
                      </div>
                      {parsed.shirts_score === null && (
                        <p className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
                          Starting side unknown — enter the score manually.
                        </p>
                      )}
                    </div>

                    {/* Per-faction stat tables (editable) */}
                    {(['SHIRTS', 'SKINS'] as const).map((faction) => {
                      const fPlayers = faction === 'SHIRTS' ? shirtsPlayers : skinsPlayers;
                      const cls = factionClass(faction, skinsSide);
                      return (
                        <div key={faction}>
                          <div className={`tracked text-[10px] mb-2 ${cls} faction-fg`}>
                            {faction}
                          </div>
                          <div className={`border border-[var(--color-border-primary)] overflow-hidden faction-tint ${cls}`}>
                            <table className="w-full border-collapse text-[12px]">
                              <thead>
                                <tr className="bg-[var(--color-bg-secondary)]">
                                  <th className="tracked text-[9px] font-semibold text-[var(--color-text-secondary)] text-left pl-3 pr-2 py-2 border-b border-[var(--color-border-primary)]">
                                    Player
                                  </th>
                                  {(['K', 'A', 'D', 'DMG', 'ADR'] as const).map((h) => (
                                    <th
                                      key={h}
                                      className="tracked text-[9px] font-semibold text-[var(--color-text-secondary)] text-right px-2 py-2 border-b border-[var(--color-border-primary)] w-14"
                                    >
                                      {h}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {fPlayers.map((p) => {
                                  const s = statMap.get(p.player_id);
                                  const d = draftStats[p.player_id];
                                  const dmgVal = d ? (parseInt(d.damage, 10) || 0) : (s?.damage ?? 0);
                                  const rounds = s?.rounds_played ?? 0;
                                  const derivedAdr = rounds > 0 ? Math.round(dmgVal / rounds) : 0;
                                  const dash = <span className="text-[var(--color-text-secondary)]">—</span>;
                                  return (
                                    <tr
                                      key={p.player_id}
                                      className="border-b border-[var(--color-border-tertiary)] last:border-b-0"
                                    >
                                      <td className="pl-3 pr-2 py-1.5 font-display font-semibold text-[var(--color-text-primary)] faction-fg">
                                        {p.player_name}
                                      </td>
                                      <td className="px-2 py-1.5 text-right">
                                        {d ? (
                                          <input
                                            type="number"
                                            min={0}
                                            value={d.kills}
                                            onChange={(e) => updateDraft(p.player_id, 'kills', e.target.value)}
                                            className={statInputCls}
                                          />
                                        ) : dash}
                                      </td>
                                      <td className="px-2 py-1.5 text-right">
                                        {d ? (
                                          <input
                                            type="number"
                                            min={0}
                                            value={d.assists}
                                            onChange={(e) => updateDraft(p.player_id, 'assists', e.target.value)}
                                            className={statInputCls}
                                          />
                                        ) : dash}
                                      </td>
                                      <td className="px-2 py-1.5 text-right">
                                        {d ? (
                                          <input
                                            type="number"
                                            min={0}
                                            value={d.deaths}
                                            onChange={(e) => updateDraft(p.player_id, 'deaths', e.target.value)}
                                            className={statInputCls}
                                          />
                                        ) : dash}
                                      </td>
                                      <td className="px-2 py-1.5 text-right">
                                        {d ? (
                                          <input
                                            type="number"
                                            min={0}
                                            value={d.damage}
                                            onChange={(e) => updateDraft(p.player_id, 'damage', e.target.value)}
                                            className={statInputCls}
                                          />
                                        ) : dash}
                                      </td>
                                      <td className="px-2 pr-3 py-1.5 text-right font-mono tnum font-semibold text-[var(--color-text-secondary)]">
                                        {s ? derivedAdr : dash}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}

                    {error && (
                      <p className="text-[12px] text-[var(--color-accent-red-fg,#ef4444)]">{error}</p>
                    )}

                    <button
                      onClick={handleSubmit}
                      disabled={stage === 'submitting' || isPending}
                      className="w-full py-2 tracked text-[11px] font-semibold border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-80 transition-opacity"
                    >
                      {stage === 'submitting' ? 'Saving…' : alreadyPlayed ? 'Save Changes' : 'Submit Results'}
                    </button>

                    <button
                      onClick={() => {
                        setParsed(null);
                        setDraftStats({});
                        setStage('idle');
                      }}
                      disabled={stage === 'submitting'}
                      className="text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors text-center"
                    >
                      {alreadyPlayed ? 'Upload a new demo' : 'Upload a different demo'}
                    </button>
                  </>
                )}

                {error && stage === 'idle' && (
                  <p className="text-[12px] text-[var(--color-accent-red-fg,#ef4444)]">{error}</p>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
