'use client';

// Admin view of a season's post-season survey: before one is opened, a builder for the question list
// (custom questions and the fixed core ones, in any order); afterward, the open/close control, the
// anonymised results, and a reset that deletes the survey and its responses to return to the builder.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAsyncAction } from './useAsyncAction';
import { sendFeedbackRequest } from './feedbackRequest';
import { ADMIN_PRIMARY_BUTTON_CLS, ADMIN_SMALL_BUTTON_CLS, FORM_INPUT_CLS } from './ArmedConfirmButton';
import SectionLabel from './SectionLabel';
import { FeedbackOpenControl } from './FeedbackOpenControl';
import { FeedbackResetControl } from './FeedbackResetControl';
import { RemoveXButton } from './RemoveXButton';
import { SortableList } from './SortableList';
import {
  CORE_SURVEY_QUESTIONS,
  isCoreDraft,
  MAX_CUSTOM_QUESTIONS,
  MAX_PROMPT_LENGTH,
  RATING_LABELS,
  RATING_MIN,
  type SurveyQuestionDraft,
  type SurveyQuestionInput,
  type SurveyQuestionKind,
} from '@/lib/survey';
import type { SurveyResults as SurveyResultsData } from '@/lib/queries';

const KIND_LABEL: Record<SurveyQuestionKind, string> = {
  rating: '1–5 rating',
  yes_no: 'Yes / No',
  text: 'Free text',
};


export function SurveyAdminPanel({ seasonId, survey }: { seasonId: number; survey: SurveyResultsData | null }) {
  return (
    <section className="flex flex-col gap-4">
      {survey ? <SurveyResults seasonId={seasonId} survey={survey} /> : <SurveyBuilder seasonId={seasonId} />}
    </section>
  );
}

type KeyedDraft = SurveyQuestionDraft & { key: string };

function SurveyBuilder({ seasonId }: { seasonId: number }) {
  const router = useRouter();
  // The whole question list in display order: custom questions are editable, core ones fixed text.
  // `key` is a stable row identity (the server ignores it), so a row keeps its focus and drag state
  // as others are added, removed, or moved.
  const [drafts, setDrafts] = useState<KeyedDraft[]>(() => CORE_SURVEY_QUESTIONS.map((_, core) => ({ core, key: `core-${core}` })));
  const nextKey = useRef(0);
  const { busy, error, run } = useAsyncAction();
  const customCount = drafts.filter((d) => !isCoreDraft(d)).length;

  function update(i: number, patch: Partial<SurveyQuestionInput>) {
    setDrafts((prev) => prev.map((q, k) => (k === i ? { ...q, ...patch } : q)));
  }

  async function open() {
    await run(async () => {
      await sendFeedbackRequest('POST', `/api/seasons/${seasonId}/survey`, { questions: drafts });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <SectionLabel>Questions (asked in this order — add your own, drag to reorder)</SectionLabel>
        <SortableList
          className="flex flex-col gap-2"
          items={drafts}
          getKey={(q) => q.key}
          onReorder={setDrafts}
          disabled={busy}
          renderRow={(q, i, handle) => (
            <div className="flex flex-wrap items-center gap-2">
              {handle}
              {isCoreDraft(q) ? (
                <>
                  <span className="flex-1 min-w-[220px] font-mono text-[12px] text-[var(--color-text-secondary)]">
                    {CORE_SURVEY_QUESTIONS[q.core].prompt}
                  </span>
                  <span className="tracked text-[9px] text-[var(--color-text-secondary)]">Core</span>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    value={q.prompt}
                    onChange={(e) => update(i, { prompt: e.target.value })}
                    maxLength={MAX_PROMPT_LENGTH}
                    placeholder="Question"
                    className={`${FORM_INPUT_CLS} flex-1 min-w-[220px]`}
                  />
                  <select value={q.kind} onChange={(e) => update(i, { kind: e.target.value as SurveyQuestionKind })} className={FORM_INPUT_CLS}>
                    {(Object.keys(KIND_LABEL) as SurveyQuestionKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  <RemoveXButton label="Remove question" onClick={() => setDrafts((prev) => prev.filter((_, k) => k !== i))} disabled={busy} />
                </>
              )}
            </div>
          )}
        />
        <button
          type="button"
          onClick={() => setDrafts((prev) => [...prev, { kind: 'rating', prompt: '', key: `custom-${nextKey.current++}` }])}
          disabled={customCount >= MAX_CUSTOM_QUESTIONS}
          className={`${ADMIN_SMALL_BUTTON_CLS} disabled:opacity-40 mt-3`}
        >
          + Add question
        </button>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={open}
          disabled={busy || drafts.some((q) => !isCoreDraft(q) && !q.prompt.trim())}
          className={`${ADMIN_PRIMARY_BUTTON_CLS} disabled:opacity-40`}
        >
          {busy ? 'Opening…' : 'Open survey'}
        </button>
        {error && <span className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">{error}</span>}
      </div>
    </div>
  );
}

function SurveyResults({ seasonId, survey }: { seasonId: number; survey: SurveyResultsData }) {
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
      <FeedbackOpenControl
        isOpen={survey.isOpen}
        status={`${survey.responseCount} of ${survey.eligibleCount} players responded`}
        openLabel="Open survey"
        closeLabel="Close survey"
        busy={busy}
        onToggle={() => setOpen(!survey.isOpen)}
      />
      <FeedbackResetControl
        url={`/api/seasons/${seasonId}/survey`}
        triggerLabel="Reset survey"
        confirmLabel="Delete survey & all responses"
      />
      {error && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">{error}</div>}

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
