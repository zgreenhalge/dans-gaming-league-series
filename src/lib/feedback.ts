// Rules shared by the post-season survey and the superlatives vote. Both are a per-season form an
// admin sets up, opens, and closes, and that players answer once each while it is open.

/** The lock rule: a form's questions (or superlatives) are frozen while it is open or once any
 *  player has answered, so no answer lands on a list the player didn't see. Closing alone doesn't
 *  unlock it — an admin reset, which deletes every answer, does. The `replace_survey_questions()`
 *  RPC applies the same rule in SQL. */
export function isFeedbackLocked(isOpen: boolean, hasAnswers: boolean): boolean {
  return isOpen || hasAnswers;
}
