'use client';

import { useMemo, useState } from 'react';
import {
  buildFormatPlan,
  describeFormatSettings,
  formatIssues,
  FORMAT_MAX_WEEKS,
  FORMAT_MIN_DIVISION_SIZE,
  FORMAT_MIN_WEEKS,
  LOPSIDED_MARGIN,
  type DraftBasis,
  type DraftOrder,
  type FormatGame,
  type FormatHalf,
  type FormatPlan,
  type SeasonFormatSettings,
  type WeekShape,
} from '@/lib/season-format';
import type { ScheduleLabPlayer, ScheduleLabRoster } from '@/lib/queries';
import { tabCls } from '@/lib/util';
import TabBar from './TabBar';
import Th from './Th';
import { StatTable, Td, Tr } from './StatTable';
import SectionLabel from './SectionLabel';
import EmptyState from './EmptyState';
import ErrorText from './ErrorText';
import { ADMIN_PRIMARY_BUTTON_CLS, ADMIN_SMALL_BUTTON_CLS } from './adminButtonStyles';

type Settings = Omit<SeasonFormatSettings, 'seed'>;

interface Preview {
  id: number;
  label: string;
  playerCount: number;
  /** The season whose records a win-rate draft ranked by; null for any other draft. */
  draftSeasonLabel: string | null;
  plan: FormatPlan;
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
];

const MAX_PREVIEWS = 6;
const LOPSIDED_PCT = `${Math.round((0.5 - LOPSIDED_MARGIN) * 100)}–${Math.round((0.5 + LOPSIDED_MARGIN) * 100)}%`;

/** Scorecard rows of the comparison table, in display order. */
const SCORE_ROWS: { label: string; title?: string; value: (p: Preview) => string }[] = [
  { label: 'Players', value: (p) => String(p.playerCount) },
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

/** A preview's settings line, naming the season a win-rate draft ranked by. */
function previewSummary(p: Preview): string {
  const summary = describeFormatSettings(p.plan.settings);
  return p.draftSeasonLabel ? `${summary} · ${p.draftSeasonLabel} records` : summary;
}

/** How a half's divisions were drafted, e.g. "snake draft by EHOG" or "tiered re-draft by
 * simulated first-half win rate". */
function halfDraftLabel(half: FormatHalf, order: DraftOrder, seasonLabel: string | null): string {
  const basis = {
    ehog: 'by EHOG',
    'win-rate': `by ${seasonLabel ?? 'season'} win rate`,
    random: 'at random',
    'first-half-win-rate': 'by simulated first-half win rate',
  }[half.draftedBy];
  return `${order} ${half.draftedBy === 'first-half-win-rate' ? 're-draft' : 'draft'} ${basis}`;
}

function previewLabel(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}

export function ScheduleLabView({ players, rosters }: { players: ScheduleLabPlayer[]; rosters: ScheduleLabRoster[] }) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(rosters[0]?.playerIds ?? []));
  const [settings, setSettings] = useState<Settings>({
    weeks: 8,
    weekShape: 'match',
    divisions: 1,
    draftBasis: 'ehog',
    draftOrder: 'snake',
    halfwayShuffle: true,
    ehogBalance: true,
  });
  // A win-rate draft ranks by one season's records; default to the newest season with any.
  const seasonsWithRecords = rosters.filter((r) => Object.values(r.records).some((rec) => rec.wins + rec.losses > 0));
  const [draftSeasonId, setDraftSeasonId] = useState<number | null>(seasonsWithRecords[0]?.seasonId ?? null);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [shownId, setShownId] = useState<number | null>(null);
  const [generated, setGenerated] = useState(0);
  const [busy, setBusy] = useState(false);

  const namesById = useMemo(() => new Map(players.map((p) => [p.id, p.name])), [players]);
  const maxDivisions = Math.max(1, Math.floor(selected.size / FORMAT_MIN_DIVISION_SIZE));
  const issues = formatIssues(selected.size, { ...settings, seed: 0 });
  const shown = previews.find((p) => p.id === shownId) ?? null;

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
    const draftSeason = settings.draftBasis === 'win-rate' ? (rosters.find((r) => r.seasonId === draftSeasonId) ?? null) : null;
    const roster = players.filter((p) => selected.has(p.id)).map((p) => ({ ...p, record: draftSeason?.records[p.id] ?? null }));
    setGenerated(seed);
    setBusy(true);
    // Yield one frame so the busy state paints before the (synchronous) search runs.
    setTimeout(() => {
      const result = buildFormatPlan(roster, { ...settings, seed });
      setBusy(false);
      if (!result.ok) return;
      const preview = { id: seed, label: previewLabel(seed - 1), playerCount: roster.length, draftSeasonLabel: draftSeason?.label ?? null, plan: result.plan };
      setPreviews((prev) => [...prev, preview].slice(-MAX_PREVIEWS));
      setShownId(seed);
    }, 30);
  }

  return (
    <div className="flex flex-col gap-10">
      <section>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <SectionLabel>Roster · {selected.size} selected</SectionLabel>
          <select
            aria-label="Load a season's roster"
            className="font-mono text-[12px] px-2 py-1 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] mb-2"
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
            const on = selected.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => togglePlayer(p.id)}
                className={`font-mono text-[12px] px-2.5 py-1 border transition-colors ${
                  on
                    ? 'border-[var(--color-site-accent)] text-[var(--color-text-primary)] bg-[var(--color-bg-secondary)]'
                    : 'border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {p.name}
                <span className="ml-1.5 text-[10px] text-[var(--color-text-secondary)]">{Math.round(p.ehog)}</span>
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
                  className="font-mono text-[12px] px-2 py-1 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
                  value={draftSeasonId ?? ''}
                  onChange={(e) => setDraftSeasonId(Number(e.target.value))}
                >
                  {seasonsWithRecords.map((r) => (
                    <option key={r.seasonId} value={r.seasonId}>
                      {r.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <Choice label="Draft order" options={DRAFT_ORDERS} value={settings.draftOrder} onChange={(draftOrder) => update({ draftOrder })} />
          </div>
        )}
        <div className="flex flex-wrap items-end gap-x-8 gap-y-5">
          <div className="flex flex-col gap-2 font-mono text-[12px]">
            <label className={`flex items-center gap-2 ${settings.divisions === 1 ? 'opacity-40' : ''}`}>
              <input type="checkbox" checked={settings.halfwayShuffle} disabled={settings.divisions === 1} onChange={(e) => update({ halfwayShuffle: e.target.checked })} />
              Reshuffle divisions at halfway
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={settings.ehogBalance} onChange={(e) => update({ ehogBalance: e.target.checked })} />
              Avoid lopsided teams (EHOG)
            </label>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button type="button" className={`${ADMIN_PRIMARY_BUTTON_CLS} disabled:opacity-40 self-start`} disabled={busy || issues.length > 0} onClick={generate}>
            {busy ? 'Generating…' : 'Generate preview'}
          </button>
          <ErrorText error={issues} size={11} />
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
                  <Th key={p.id} align="left" className={`min-w-[150px] ${p.id === shownId ? 'text-[var(--color-site-accent)]' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" className="text-left hover:underline" onClick={() => setShownId(p.id)}>
                        <span className="font-display text-[14px]">{p.label}</span>
                        <span className="block font-normal text-[var(--color-text-secondary)]">{previewSummary(p)}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove preview ${p.label}`}
                        className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                        onClick={() => {
                          setPreviews((prev) => prev.filter((q) => q.id !== p.id));
                          if (shownId === p.id) setShownId(null);
                        }}
                      >
                        ×
                      </button>
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
                    <Td key={p.id} align="left" className={p.id === shownId ? 'bg-[var(--color-bg-secondary)]' : ''}>
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

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const btn = 'w-8 h-8 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-40';
  return (
    <div className="flex flex-col gap-1.5">
      <span className="tracked text-[10px] text-[var(--color-text-secondary)]">{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} className={btn} disabled={value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
        <span className="font-mono text-[14px] w-6 text-center">{value}</span>
        <button type="button" aria-label={`More ${label.toLowerCase()}`} className={btn} disabled={value >= max} onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

function PlanSchedule({ preview, namesById }: { preview: Preview; namesById: Map<number, string> }) {
  const { plan } = preview;
  const name = (id: number) => namesById.get(id) ?? `#${id}`;
  const multiDivision = plan.settings.divisions > 1;

  return (
    <section className="flex flex-col gap-8">
      <div>
        <SectionLabel>Preview {preview.label} schedule</SectionLabel>
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
}

function GameLine({ game, name }: { game: FormatGame; name: (id: number) => string }) {
  const pct = Math.round(game.shirtsWinProb * 100);
  const lopsided = Math.abs(game.shirtsWinProb - 0.5) > LOPSIDED_MARGIN;
  return (
    <div className="grid grid-cols-[1fr_auto_1fr_auto] items-baseline gap-2 font-mono text-[12px]">
      <span className="truncate">{game.shirts.map(name).join(' + ')}</span>
      <span className="text-[10px] text-[var(--color-text-secondary)]">vs</span>
      <span className="truncate">{game.skins.map(name).join(' + ')}</span>
      <span
        className={`text-[11px] tabular-nums ${lopsided ? 'text-[var(--color-accent-amber-fg)]' : 'text-[var(--color-text-secondary)]'}`}
        title="Shirts’ predicted win chance (EHOG)"
      >
        {pct}%
      </span>
    </div>
  );
}
