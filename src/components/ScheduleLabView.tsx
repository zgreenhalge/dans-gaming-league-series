'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  divisionSizesFor,
  formatIssues,
  isLopsided,
  FORMAT_MAX_WEEKS,
  FORMAT_MIN_DIVISION_SIZE,
  FORMAT_MIN_WEEKS,
  LOPSIDED_MARGIN,
  type DraftBasis,
  type DraftOrder,
  type FormatGame,
  type FormatHalf,
  type FormatPlan,
  type FormatRecord,
  type FormatResult,
  type HalfwayRedraft,
  type SeasonFormatSettings,
  type WeekShape,
} from '@/lib/season-format';
import type { FormatWorkerRequest } from '@/lib/season-format.worker';
import type { ScheduleLabPlayer, ScheduleLabRoster } from '@/lib/queries';
import { tabCls } from '@/lib/util';
import TabBar from './TabBar';
import Th from './Th';
import { StatTable, Td, Tr } from './StatTable';
import SectionLabel from './SectionLabel';
import { Stepper } from './Stepper';
import EmptyState from './EmptyState';
import ErrorText from './ErrorText';
import { ADMIN_PRIMARY_BUTTON_CLS, ADMIN_SMALL_BUTTON_CLS } from './adminButtonStyles';
import { SELECT_CLS } from './formStyles';
import { RemoveXButton } from './RemoveXButton';

type Settings = Omit<SeasonFormatSettings, 'seed'>;

/** A generated plan, identified by its seed (each Generate uses the next one). */
interface Preview {
  plan: FormatPlan;
  /** The season whose records a win-rate draft ranked by; null for any other draft. */
  draftSeasonLabel: string | null;
}

const WEEK_SHAPES: { value: WeekShape; label: string }[] = [
  { value: 'match', label: '1 match' },
  { value: 'group', label: '1 group (2 games)' },
];
const DRAFT_BASES: { value: DraftBasis; label: string }[] = [
  { value: 'ehog', label: 'EHOG' },
  { value: 'win-rate', label: 'Win rate' },
  { value: 'random', label: 'Random' },
];
const DRAFT_ORDERS: { value: DraftOrder; label: string }[] = [
  { value: 'snake', label: 'Snake' },
  { value: 'straight', label: 'Straight' },
  { value: 'tiered', label: 'Tiered' },
  { value: 'balanced', label: 'Balanced' },
];
const HALFWAY_REDRAFTS: { value: HalfwayRedraft; label: string }[] = [
  { value: 'win-rate', label: 'First-half win rate' },
  { value: 'new-pairings', label: 'Most new pairings' },
];
const CAREER = 'career';

const MAX_PREVIEWS = 6;
const LOPSIDED_PCT = `${Math.round((0.5 - LOPSIDED_MARGIN) * 100)}–${Math.round((0.5 + LOPSIDED_MARGIN) * 100)}%`;

/** Scorecard rows of the comparison table, in display order. */
const SCORE_ROWS: { label: string; title?: string; value: (p: Preview) => string }[] = [
  { label: 'Players', value: (p) => String(playerCount(p)) },
  { label: 'Games each', value: (p) => range(p.plan.scorecard.gamesPerPlayer) },
  { label: 'Most games in a week', value: (p) => String(p.plan.scorecard.maxGamesInAWeek) },
  { label: 'Weeks sat out', title: 'Total player-weeks with no game, league-wide', value: (p) => String(p.plan.scorecard.idlePlayerWeeks) },
  {
    label: 'Different teammates',
    title: 'How many different players each player partners with',
    value: (p) => `${range(p.plan.scorecard.distinctTeammates)} of ${p.plan.scorecard.distinctTeammates.possible}`,
  },
  { label: 'Pairs who partner', value: (p) => `${p.plan.scorecard.pairsPartnered} / ${p.plan.scorecard.pairs}` },
  {
    label: 'Pairs who never meet',
    title: 'Pairs of players who are never teammates or opponents all season',
    value: (p) => `${p.plan.scorecard.pairsNeverMet} / ${p.plan.scorecard.pairs}`,
  },
  { label: 'Repeat teammate pairs', title: 'Pairs who are teammates more than once', value: (p) => String(p.plan.scorecard.repeatTeammatePairs) },
  {
    label: 'Lopsided games',
    title: `Games whose predicted win chance (EHOG) is outside ${LOPSIDED_PCT}`,
    value: (p) => `${p.plan.scorecard.lopsidedGames} / ${p.plan.scorecard.games}`,
  },
  { label: 'Worst side imbalance', title: 'Largest gap between a player’s Shirts and Skins games', value: (p) => `±${p.plan.scorecard.maxSideImbalance}` },
];

function range({ min, max }: { min: number; max: number }): string {
  return min === max ? String(min) : `${min}–${max}`;
}

const previewId = (p: Preview) => p.plan.settings.seed;
const previewLetter = (p: Preview) => String.fromCharCode(65 + ((previewId(p) - 1) % 26));
const playerCount = (p: Preview) => p.plan.halves[0].divisions.flat().length;
const labelOf = <T extends string>(options: { value: T; label: string }[], value: T) => options.find((o) => o.value === value)!.label;

/** A preview's settings line, e.g. "8 weeks · 1 match a week · 2 divisions (snake, EHOG), halfway
 * re-draft: most new pairings", naming the season a win-rate draft ranked by. */
function previewSummary({ plan: { settings: s }, draftSeasonLabel }: Preview): string {
  const parts = [`${s.weeks} weeks`, `${labelOf(WEEK_SHAPES, s.weekShape)} a week`];
  if (s.divisions > 1) {
    const order = labelOf(DRAFT_ORDERS, s.draftOrder).toLowerCase() + (s.draftOrder === 'tiered' && s.tierSizes ? ` ${s.tierSizes.join('/')}` : '');
    const halfway = s.halfwayShuffle ? `, halfway re-draft: ${labelOf(HALFWAY_REDRAFTS, s.halfwayRedraft).toLowerCase()}` : '';
    parts.push(`${s.divisions} divisions (${order}, ${labelOf(DRAFT_BASES, s.draftBasis)})${halfway}`);
  }
  if (!s.ehogBalance) parts.push('no EHOG balancing');
  if (draftSeasonLabel) parts.push(`${draftSeasonLabel} records`);
  return parts.join(' · ');
}

/** How a half's divisions were drafted, e.g. "snake draft by EHOG", "tiered re-draft by simulated
 * first-half win rate" or "re-drafted for the most new pairings". */
function halfDraftLabel(half: FormatHalf, order: DraftOrder, seasonLabel: string | null): string {
  if (half.draftedBy === 'new-pairings') return 're-drafted for the most new pairings';
  const basis = {
    ehog: 'by EHOG',
    'win-rate': `by ${seasonLabel ?? 'season'} win rate`,
    random: 'at random',
    'first-half-win-rate': 'by simulated first-half win rate',
  }[half.draftedBy];
  return `${order} ${half.draftedBy === 'first-half-win-rate' ? 're-draft' : 'draft'} ${basis}`;
}

export function ScheduleLabView({
  players,
  rosters,
  careerRecords,
}: {
  players: ScheduleLabPlayer[];
  rosters: ScheduleLabRoster[];
  careerRecords: Record<number, FormatRecord>;
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(rosters[0]?.playerIds ?? []));
  const [chosen, setSettings] = useState<Settings>({
    weeks: 8,
    weekShape: 'match',
    divisions: 1,
    draftBasis: 'ehog',
    draftOrder: 'snake',
    tierSizes: null,
    halfwayShuffle: true,
    halfwayRedraft: 'win-rate',
    ehogBalance: true,
  });
  // A win-rate draft ranks by one season's records, or every regular season's; default to the
  // newest season with any.
  const seasonsWithRecords = rosters.filter((r) => Object.values(r.records).some((rec) => rec.wins + rec.losses > 0));
  const [draftSource, setDraftSource] = useState<number | typeof CAREER>(seasonsWithRecords[0]?.seasonId ?? CAREER);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [shownId, setShownId] = useState<number | null>(null);
  const [generated, setGenerated] = useState(0);
  const [busy, setBusy] = useState(false);
  const [workerError, setWorkerError] = useState<string | null>(null);
  // The worker running the current Generate, if any; terminating it cancels the search.
  const workerRef = useRef<Worker | null>(null);
  useEffect(() => () => workerRef.current?.terminate(), []);

  const namesById = useMemo(() => new Map(players.map((p) => [p.playerId, p.name])), [players]);
  const maxDivisions = Math.max(1, Math.floor(selected.size / FORMAT_MIN_DIVISION_SIZE));
  // The chosen division count, lowered to what the roster supports so the controls and the
  // generated settings agree when the roster shrinks.
  const settings: Settings = { ...chosen, divisions: Math.min(chosen.divisions, maxDivisions) };
  // Tier sizes the admin set, as long as they still fit the roster and division count; otherwise even.
  const evenSizes = divisionSizesFor(selected.size, settings.divisions);
  const setSizes = settings.tierSizes;
  const tierSizes =
    setSizes && setSizes.length === settings.divisions && setSizes.reduce((a, v) => a + v, 0) === selected.size ? setSizes : evenSizes;
  const effective: Settings = { ...settings, tierSizes: settings.draftOrder === 'tiered' ? tierSizes : null };
  const issues = formatIssues(selected.size, { ...effective, seed: 0 });
  const setTierSize = (d: number, size: number) => {
    const next = [...tierSizes];
    next[d] = size;
    next[next.length - 1] = selected.size - next.slice(0, -1).reduce((a, v) => a + v, 0);
    update({ tierSizes: next });
  };
  const shown = previews.find((p) => previewId(p) === shownId) ?? null;

  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  const togglePlayer = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function generate() {
    const seed = generated + 1;
    // Records only matter to a win-rate draft, which needs divisions to draft into.
    const source =
      settings.divisions === 1 || settings.draftBasis !== 'win-rate'
        ? null
        : draftSource === CAREER
          ? { label: 'Career', records: careerRecords }
          : (rosters.find((r) => r.seasonId === draftSource) ?? null);
    const roster = players.filter((p) => selected.has(p.playerId)).map((p) => ({ ...p, record: source?.records[p.playerId] ?? null }));
    setGenerated(seed);
    setBusy(true);
    setWorkerError(null);
    // The annealing search runs off the main thread so the page stays responsive and can cancel.
    try {
      const worker = new Worker(new URL('../lib/season-format.worker.ts', import.meta.url));
      workerRef.current = worker;
      worker.onmessage = (e: MessageEvent<FormatResult>) => {
        stopWorker();
        if (!e.data.ok) {
          setWorkerError(e.data.issues.join(' '));
          return;
        }
        const plan = e.data.plan;
        setPreviews((prev) => [...prev, { plan, draftSeasonLabel: source?.label ?? null }].slice(-MAX_PREVIEWS));
        setShownId(seed);
      };
      worker.onerror = () => {
        stopWorker();
        setWorkerError('Generating the preview failed.');
      };
      const request: FormatWorkerRequest = { players: roster, settings: { ...effective, seed } };
      worker.postMessage(request);
    } catch {
      stopWorker();
      setWorkerError('Generating the preview failed.');
    }
  }

  function stopWorker() {
    workerRef.current?.terminate();
    workerRef.current = null;
    setBusy(false);
  }

  function cancel() {
    stopWorker();
    setGenerated((g) => g - 1);
  }

  return (
    <div className="flex flex-col gap-10">
      <section>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <SectionLabel>Roster · {selected.size} selected</SectionLabel>
          <select
            aria-label="Load a season's roster"
            className={`${SELECT_CLS} mb-2`}
            value=""
            onChange={(e) => {
              const roster = rosters.find((r) => r.seasonId === Number(e.target.value));
              if (roster) setSelected(new Set(roster.playerIds));
            }}
          >
            <option value="" disabled>
              Load a season’s roster…
            </option>
            {rosters.map((r) => (
              <option key={r.seasonId} value={r.seasonId}>
                {r.label} ({r.playerIds.length})
              </option>
            ))}
          </select>
          <button type="button" className={`${ADMIN_SMALL_BUTTON_CLS} mb-2`} onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {players.map((p) => {
            const on = selected.has(p.playerId);
            return (
              <button
                key={p.playerId}
                type="button"
                aria-pressed={on}
                onClick={() => togglePlayer(p.playerId)}
                className={`font-mono text-[12px] px-2.5 py-1 border transition-colors ${
                  on
                    ? 'border-[var(--color-site-accent)] text-[var(--color-text-primary)] bg-[var(--color-bg-secondary)]'
                    : 'border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {p.name}
                <span className="ml-1.5 text-[10px] text-[var(--color-text-secondary)]">{Math.round(p.ehogRating)}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-5">
        <SectionLabel>Format</SectionLabel>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-5">
          <Stepper label="Weeks" value={settings.weeks} min={FORMAT_MIN_WEEKS} max={FORMAT_MAX_WEEKS} onChange={(weeks) => update({ weeks })} />
          <Choice label="Each week" options={WEEK_SHAPES} value={settings.weekShape} onChange={(weekShape) => update({ weekShape })} />
          <Stepper label="Divisions" value={settings.divisions} min={1} max={maxDivisions} onChange={(divisions) => update({ divisions })} />
        </div>
        {settings.divisions > 1 && (
          <div className="flex flex-wrap items-end gap-x-8 gap-y-5">
            <div className="flex flex-wrap items-end gap-3">
              <Choice label="Draft divisions by" options={DRAFT_BASES} value={settings.draftBasis} onChange={(draftBasis) => update({ draftBasis })} />
              {settings.draftBasis === 'win-rate' && (
                <select
                  aria-label="Season whose win rates the draft ranks by"
                  className={SELECT_CLS}
                  value={draftSource}
                  onChange={(e) => setDraftSource(e.target.value === CAREER ? CAREER : Number(e.target.value))}
                >
                  {seasonsWithRecords.map((r) => (
                    <option key={r.seasonId} value={r.seasonId}>
                      {r.label}
                    </option>
                  ))}
                  <option value={CAREER}>All regular seasons</option>
                </select>
              )}
            </div>
            <Choice label="Draft order" options={DRAFT_ORDERS} value={settings.draftOrder} onChange={(draftOrder) => update({ draftOrder })} />
            {settings.draftOrder === 'tiered' && (
              <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                {tierSizes.slice(0, -1).map((size, d) => (
                  <Stepper
                    key={d}
                    label={`Division ${d + 1}`}
                    value={size}
                    min={FORMAT_MIN_DIVISION_SIZE}
                    max={size + tierSizes[tierSizes.length - 1] - FORMAT_MIN_DIVISION_SIZE}
                    onChange={(v) => setTierSize(d, v)}
                  />
                ))}
                <div className="flex flex-col gap-1.5">
                  <span className="tracked text-[10px] text-[var(--color-text-secondary)]">Division {tierSizes.length}</span>
                  <span className="font-mono text-[14px] h-8 flex items-center">{tierSizes[tierSizes.length - 1]}</span>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-x-8 gap-y-5">
          <div className="flex flex-col gap-2 font-mono text-[12px]">
            <label className={`flex items-center gap-2 ${settings.divisions === 1 ? 'opacity-40' : ''}`}>
              <input type="checkbox" checked={settings.halfwayShuffle} disabled={settings.divisions === 1} onChange={(e) => update({ halfwayShuffle: e.target.checked })} />
              Re-draft divisions at halfway
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={settings.ehogBalance} onChange={(e) => update({ ehogBalance: e.target.checked })} />
              Avoid lopsided teams (EHOG)
            </label>
          </div>
        </div>
        {settings.divisions > 1 && settings.halfwayShuffle && (
          <Choice label="Halfway re-draft by" options={HALFWAY_REDRAFTS} value={settings.halfwayRedraft} onChange={(halfwayRedraft) => update({ halfwayRedraft })} />
        )}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <button type="button" className={`${ADMIN_PRIMARY_BUTTON_CLS} disabled:opacity-40 self-start`} disabled={busy || issues.length > 0} onClick={generate}>
              {busy ? 'Generating…' : 'Generate preview'}
            </button>
            {busy && (
              <button type="button" className={ADMIN_SMALL_BUTTON_CLS} onClick={cancel}>
                Cancel
              </button>
            )}
          </div>
          <ErrorText error={issues} size={11} />
          <ErrorText error={workerError} size={11} />
        </div>
      </section>

      <section>
        <SectionLabel>Compare</SectionLabel>
        {previews.length === 0 ? (
          <EmptyState size="sm" message="No previews yet." />
        ) : (
          <StatTable>
            <thead>
              <tr>
                <Th sticky />
                {previews.map((p) => (
                  <Th key={previewId(p)} align="left" className={`min-w-[150px] ${previewId(p) === shownId ? 'text-[var(--color-site-accent)]' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" className="text-left hover:underline" onClick={() => setShownId(previewId(p))}>
                        <span className="font-display text-[14px]">{previewLetter(p)}</span>
                        <span className="block font-normal text-[var(--color-text-secondary)]">{previewSummary(p)}</span>
                      </button>
                      <RemoveXButton
                        label={`Remove preview ${previewLetter(p)}`}
                        onClick={() => {
                          setPreviews((prev) => prev.filter((q) => q !== p));
                          if (shownId === previewId(p)) setShownId(null);
                        }}
                      />
                    </div>
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SCORE_ROWS.map((row) => (
                <Tr key={row.label}>
                  <Td align="left" muted className="sticky-col" title={row.title}>
                    {row.label}
                  </Td>
                  {previews.map((p) => (
                    <Td key={previewId(p)} align="left" className={previewId(p) === shownId ? 'bg-[var(--color-bg-secondary)]' : ''}>
                      {row.value(p)}
                    </Td>
                  ))}
                </Tr>
              ))}
            </tbody>
          </StatTable>
        )}
      </section>

      {shown && <PlanSchedule preview={shown} namesById={namesById} />}
    </div>
  );
}

function Choice<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="tracked text-[10px] text-[var(--color-text-secondary)]">{label}</span>
      <TabBar bordered>
        {options.map((o) => (
          <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={tabCls(value === o.value, { compact: true })} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </TabBar>
    </div>
  );
}

// Memoized: the schedule can run to hundreds of rows, and its inputs don't change when the controls
// above it do.
const PlanSchedule = memo(function PlanSchedule({ preview, namesById }: { preview: Preview; namesById: Map<number, string> }) {
  const { plan } = preview;
  const name = (id: number) => namesById.get(id) ?? `#${id}`;
  const multiDivision = plan.settings.divisions > 1;

  return (
    <section className="flex flex-col gap-8">
      <div>
        <SectionLabel>Preview {previewLetter(preview)} schedule</SectionLabel>
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">{previewSummary(preview)}</div>
      </div>
      {plan.halves.map((half) => (
        <div key={half.half} className="flex flex-col gap-4">
          {multiDivision && (
            <div className="flex flex-col gap-2">
              <div className="tracked text-[11px]">
                Weeks {half.firstWeek}–{half.lastWeek} · {halfDraftLabel(half, plan.settings.draftOrder, preview.draftSeasonLabel)}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {half.divisions.map((ids, d) => (
                  <div key={d} className="border border-[var(--color-border-primary)] p-2 font-mono text-[12px]">
                    <div className="text-[10px] text-[var(--color-text-secondary)] mb-1">Division {d + 1}</div>
                    {ids.map((id) => {
                      const record = half.records?.[id];
                      return (
                        <div key={id} className="flex justify-between gap-2">
                          <span>{name(id)}</span>
                          {record && (
                            <span className="text-[var(--color-text-secondary)]">
                              {record.wins}-{record.losses}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {plan.weeks
              .filter((w) => w.half === half.half)
              .map((w) => (
                <div key={w.week} className="border border-[var(--color-border-primary)]">
                  <div className="px-3 py-1.5 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border-primary)] tracked text-[11px]">Week {w.week}</div>
                  <div className="p-3 flex flex-col gap-3">
                    {w.divisions.map((d) => (
                      <div key={d.division} className="flex flex-col gap-1">
                        {multiDivision && <div className="text-[10px] font-mono text-[var(--color-text-secondary)]">Division {d.division}</div>}
                        {d.games.map((g, i) => (
                          <div key={i}>
                            {g.group !== null && (i === 0 || d.games[i - 1].group !== g.group) && (
                              <div className="text-[10px] font-mono text-[var(--color-text-secondary)] mt-1">Group {g.group}</div>
                            )}
                            <GameLine game={g} name={name} />
                          </div>
                        ))}
                        {d.idlePlayerIds.length > 0 && (
                          <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">Sits out: {d.idlePlayerIds.map(name).join(', ')}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}
    </section>
  );
});

function GameLine({ game, name }: { game: FormatGame; name: (id: number) => string }) {
  const pct = Math.round(game.shirtsWinProb * 100);
  return (
    <div className="grid grid-cols-[1fr_auto_1fr_auto] items-baseline gap-2 font-mono text-[12px]">
      <span className="truncate">{game.shirts.map(name).join(' + ')}</span>
      <span className="text-[10px] text-[var(--color-text-secondary)]">vs</span>
      <span className="truncate">{game.skins.map(name).join(' + ')}</span>
      <span
        className={`text-[11px] tabular-nums ${isLopsided(game.shirtsWinProb) ? 'text-[var(--color-accent-amber-fg)]' : 'text-[var(--color-text-secondary)]'}`}
        title="Shirts’ predicted win chance (EHOG)"
      >
        {pct}%
      </span>
    </div>
  );
}
