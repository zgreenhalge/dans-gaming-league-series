// Pure rules both post-season forms (the survey and the superlatives vote) share. No IO.

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

/** The lock rule both forms share: a form's questions (or superlatives) are frozen while it is open
 *  or once any player has answered, so no answer lands on a list the player didn't see. Closing alone
 *  doesn't unlock it — an admin reset, which deletes every answer, does. The
 *  `replace_survey_questions()` RPC applies the same rule in SQL. */
export function isFeedbackLocked(isOpen: boolean, hasAnswers: boolean): boolean {
  return isOpen || hasAnswers;
}
