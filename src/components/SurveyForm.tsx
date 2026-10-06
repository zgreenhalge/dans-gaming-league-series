'use client';

// The player-facing post-season survey. Answers are keyed by question id; every question is
// optional, and clicking a selected rating/yes-no choice again clears it. Saving again edits the
// player's existing response (see `PUT /api/seasons/[id]/survey/response`). Once a player has
// responded the survey shows read-only until they press Edit.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAsyncAction } from './useAsyncAction';
import { sendFeedbackRequest } from './feedbackRequest';
import { ADMIN_PRIMARY_BUTTON_CLS, FORM_INPUT_CLS } from './ArmedConfirmButton';
import { RATING_LABELS, RATING_MAX, RATING_MIN, MAX_TEXT_ANSWER_LENGTH, type SurveyAnswers, type SurveyQuestion } from '@/lib/survey';

type AnswerValue = SurveyAnswers[string];

const CHOICE_CLS =
  'tracked text-[11px] font-semibold px-3 py-2 border transition-colors';
const CHOICE_IDLE =
  'border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)]';
const CHOICE_ACTIVE =
  'border-[var(--color-accent-green-border)] bg-[var(--color-accent-green-bg)] text-[var(--color-accent-green-fg)]';

export function SurveyForm({
  seasonId,
  questions,
  initialAnswers,
  responded,
}: {
  seasonId: number;
  questions: SurveyQuestion[];
  initialAnswers: SurveyAnswers;
  responded: boolean;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<SurveyAnswers>(initialAnswers);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(!responded);
  const { busy, error, run } = useAsyncAction();

  function setAnswer(id: number, value: AnswerValue | undefined) {
    const key = String(id);
    setSaved(false);
    setAnswers((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  async function save() {
    await run(async () => {
      await sendFeedbackRequest('PUT', `/api/seasons/${seasonId}/survey/response`, { answers });
      setSaved(true);
      setEditing(false);
      router.refresh();
    });
  }

  function answerText(q: SurveyQuestion): string {
    const value = answers[String(q.id)];
    if (value === undefined) return 'No answer';
    if (typeof value === 'number') return `${value} · ${RATING_LABELS[value]}`;
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return value;
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => {
              setSaved(false);
              setEditing(true);
            }}
            className="tracked text-[10px] font-semibold text-[var(--color-accent-green-fg)] hover:brightness-110"
          >
            Edit
          </button>
          {saved && <span className="font-mono text-[11px] text-[var(--color-accent-green-fg)]">Saved</span>}
        </div>
        {questions.map((q, i) => (
          <div key={q.id} className="flex flex-col gap-1">
            <div className="font-display text-[16px] font-semibold">
              <span className="font-mono text-[11px] text-[var(--color-text-secondary)] mr-2">{i + 1}.</span>
              {q.prompt}
            </div>
            <div className="font-mono text-[13px] text-[var(--color-text-secondary)] whitespace-pre-wrap break-words">{answerText(q)}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {questions.map((q, i) => {
        const value = answers[String(q.id)];
        return (
          <div key={q.id} className="flex flex-col gap-3">
            <div className="font-display text-[16px] font-semibold">
              <span className="font-mono text-[11px] text-[var(--color-text-secondary)] mr-2">{i + 1}.</span>
              {q.prompt}
            </div>
            {q.kind === 'rating' && (
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, k) => RATING_MIN + k).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setAnswer(q.id, value === n ? undefined : n)}
                    aria-pressed={value === n}
                    className={`${CHOICE_CLS} ${value === n ? CHOICE_ACTIVE : CHOICE_IDLE}`}
                  >
                    {n} · {RATING_LABELS[n]}
                  </button>
                ))}
              </div>
            )}
            {q.kind === 'yes_no' && (
              <div className="flex gap-2">
                {[true, false].map((choice) => (
                  <button
                    key={String(choice)}
                    type="button"
                    onClick={() => setAnswer(q.id, value === choice ? undefined : choice)}
                    aria-pressed={value === choice}
                    className={`${CHOICE_CLS} ${value === choice ? CHOICE_ACTIVE : CHOICE_IDLE}`}
                  >
                    {choice ? 'Yes' : 'No'}
                  </button>
                ))}
              </div>
            )}
            {q.kind === 'text' && (
              <textarea
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => setAnswer(q.id, e.target.value)}
                maxLength={MAX_TEXT_ANSWER_LENGTH}
                rows={4}
                className={FORM_INPUT_CLS}
              />
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-4">
        <button type="button" onClick={save} disabled={busy} className={`${ADMIN_PRIMARY_BUTTON_CLS} disabled:opacity-40`}>
          {busy ? 'Saving…' : responded || saved ? 'Update Answers' : 'Submit Survey'}
        </button>
        {(responded || saved) && (
          <button
            type="button"
            onClick={() => {
              setAnswers(initialAnswers);
              setEditing(false);
            }}
            disabled={busy}
            className="tracked text-[10px] font-semibold text-[var(--color-text-secondary)] disabled:opacity-40"
          >
            Cancel
          </button>
        )}
        {error && <span className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">{error}</span>}
      </div>
    </div>
  );
}
