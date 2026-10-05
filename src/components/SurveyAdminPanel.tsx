'use client';

// Admin view of a season's post-season survey: before one is sent, a builder for the custom
// questions (shown ahead of the fixed core questions); afterward, the open/close control and the
// anonymised results.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAsyncAction } from './useAsyncAction';
import { sendFeedbackRequest } from './feedbackAdminRequest';
import { ADMIN_PRIMARY_BUTTON_CLS } from './ArmedConfirmButton';
import SectionLabel from './SectionLabel';
import {
  CORE_SURVEY_QUESTIONS,
  MAX_CUSTOM_QUESTIONS,
  MAX_PROMPT_LENGTH,
  RATING_LABELS,
  RATING_MIN,
  type SurveyQuestionInput,
  type SurveyQuestionKind,
  type SurveyQuestionSummary,
} from '@/lib/survey';

const KIND_LABEL: Record<SurveyQuestionKind, string> = {
  rating: '1–5 rating',
  yes_no: 'Yes / No',
  text: 'Free text',
};

const INPUT_CLS =
  'font-mono text-[13px] px-3 py-2 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]';
const SMALL_BUTTON_CLS =
  'tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors disabled:opacity-40';

export interface SurveyAdminData {
  isOpen: boolean;
  responseCount: number;
  eligibleCount: number;
  summaries: SurveyQuestionSummary[];
}

export function SurveyAdminPanel({ seasonId, survey }: { seasonId: number; survey: SurveyAdminData | null }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="font-display text-[20px] font-semibold">Post-season survey</div>
      {survey ? <SurveyResults seasonId={seasonId} survey={survey} /> : <SurveyBuilder seasonId={seasonId} />}
    </section>
  );
}

function SurveyBuilder({ seasonId }: { seasonId: number }) {
  const router = useRouter();
  const [custom, setCustom] = useState<SurveyQuestionInput[]>([]);
  const { busy, error, run } = useAsyncAction();

  function update(i: number, patch: Partial<SurveyQuestionInput>) {
    setCustom((prev) => prev.map((q, k) => (k === i ? { ...q, ...patch } : q)));
  }

  async function send() {
    await run(async () => {
      await sendFeedbackRequest('POST', `/api/seasons/${seasonId}/survey`, { questions: custom });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <SectionLabel>Custom questions (asked first)</SectionLabel>
        <div className="flex flex-col gap-2">
          {custom.map((q, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={q.prompt}
                onChange={(e) => update(i, { prompt: e.target.value })}
                maxLength={MAX_PROMPT_LENGTH}
                placeholder="Question"
                className={`${INPUT_CLS} flex-1 min-w-[220px]`}
              />
              <select value={q.kind} onChange={(e) => update(i, { kind: e.target.value as SurveyQuestionKind })} className={INPUT_CLS}>
                {(Object.keys(KIND_LABEL) as SurveyQuestionKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => setCustom((prev) => prev.filter((_, k) => k !== i))} className={SMALL_BUTTON_CLS}>
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setCustom((prev) => [...prev, { kind: 'rating', prompt: '' }])}
          disabled={custom.length >= MAX_CUSTOM_QUESTIONS}
          className={`${SMALL_BUTTON_CLS} mt-3`}
        >
          + Add question
        </button>
      </div>

      <div>
        <SectionLabel>Core questions (always asked after yours)</SectionLabel>
        <ol className="list-decimal list-inside font-mono text-[12px] text-[var(--color-text-secondary)] flex flex-col gap-1">
          {CORE_SURVEY_QUESTIONS.map((q) => (
            <li key={q.prompt}>{q.prompt}</li>
          ))}
        </ol>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={send}
          disabled={busy || custom.some((q) => !q.prompt.trim())}
          className={`${ADMIN_PRIMARY_BUTTON_CLS} disabled:opacity-40`}
        >
          {busy ? 'Sending…' : 'Send survey'}
        </button>
        {error && <span className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">{error}</span>}
      </div>
    </div>
  );
}

function SurveyResults({ seasonId, survey }: { seasonId: number; survey: SurveyAdminData }) {
  const router = useRouter();
  const { busy, error, run } = useAsyncAction();

  async function setOpen(open: boolean) {
    await run(async () => {
      await sendFeedbackRequest('PATCH', `/api/seasons/${seasonId}/survey`, { open });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 font-mono text-[12px]">
        <span className="text-[var(--color-text-secondary)]">
          {survey.isOpen ? 'Open' : 'Closed'} · {survey.responseCount} of {survey.eligibleCount} players responded
        </span>
        <button type="button" onClick={() => setOpen(!survey.isOpen)} disabled={busy} className={SMALL_BUTTON_CLS}>
          {survey.isOpen ? 'Close survey' : 'Reopen survey'}
        </button>
        {error && <span className="text-[var(--color-accent-red-fg)]">{error}</span>}
      </div>

      {survey.summaries.map((q) => (
        <div key={q.question_id} className="flex flex-col gap-2 border-t border-[var(--color-border-tertiary)] pt-4">
          <div className="font-display text-[15px] font-semibold">
            {q.prompt}
            {!q.is_core && <span className="tracked text-[9px] ml-2 text-[var(--color-text-secondary)]">Custom</span>}
          </div>
          <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">
            {q.answered} {q.answered === 1 ? 'answer' : 'answers'}
          </div>
          {q.kind === 'rating' && q.average != null && (
            <div className="flex flex-col gap-1">
              <div className="font-mono text-[13px]">Average {q.average.toFixed(2)} / 5</div>
              {q.distribution.map((count, i) => (
                <div key={i} className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="w-[70px] text-[var(--color-text-secondary)]">
                    {RATING_MIN + i} · {RATING_LABELS[RATING_MIN + i]}
                  </span>
                  <div className="h-2 bg-[var(--color-site-accent)]" style={{ width: `${q.answered ? (count / q.answered) * 200 : 0}px` }} />
                  <span>{count}</span>
                </div>
              ))}
            </div>
          )}
          {q.kind === 'yes_no' && q.answered > 0 && (
            <div className="font-mono text-[13px]">
              Yes {q.yes} · No {q.no}
            </div>
          )}
          {q.kind === 'text' && q.texts.length > 0 && (
            <ul className="flex flex-col gap-2">
              {q.texts.map((t, i) => (
                <li key={i} className="font-mono text-[12px] px-3 py-2 border border-[var(--color-border-tertiary)] whitespace-pre-wrap break-words">
                  {t}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
