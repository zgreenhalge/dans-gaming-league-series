'use client';

import ErrorText from './ErrorText';
import { ADMIN_SMALL_AMBER_BUTTON_CLS, ADMIN_SMALL_BUTTON_CLS, ADMIN_SMALL_GREEN_BUTTON_CLS } from './adminButtonStyles';
import { useScrimSignupWrite } from './useScrimSignupWrite';
import { SCRIM_COMMITMENTS, type ScrimCommitment } from '@/lib/scrim-schedule';

export const COMMITMENT_LABEL: Record<ScrimCommitment, string> = { definite: 'Definite', maybe: 'Maybe' };

/** Drop out: red text with no border or fill, so it reads apart from the commitment choices. */
const DROP_OUT_BTN_CLS =
  'tracked text-[10px] font-semibold px-2 py-1 text-[var(--color-accent-red-fg,#f87171)] hover:underline transition-colors disabled:opacity-40';
export const IDLE_COMMITMENT_BTN_CLS = `${ADMIN_SMALL_BUTTON_CLS} disabled:opacity-40`;
/** A commitment button once it's the one picked: green for definite, amber for maybe. */
export const ACTIVE_COMMITMENT_BTN_CLS: Record<ScrimCommitment, string> = {
  definite: `${ADMIN_SMALL_GREEN_BUTTON_CLS} disabled:opacity-40`,
  maybe: `${ADMIN_SMALL_AMBER_BUTTON_CLS} disabled:opacity-40`,
};

/** The viewer's own commitment to scrim night `nightId`: Definite and Maybe (the current one pressed)
 *  to sign up or switch, and Drop out once they're signed up. */
export function ScrimCommitmentButtons({ nightId, playerId, commitment }: { nightId: number; playerId: number; commitment: ScrimCommitment | null }) {
  const { error, pending, setCommitment } = useScrimSignupWrite(nightId);
  const busy = pending === playerId;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span className="flex flex-wrap items-center gap-2">
        {SCRIM_COMMITMENTS.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={commitment === c}
            onClick={() => commitment !== c && setCommitment(playerId, c)}
            disabled={busy}
            className={commitment === c ? ACTIVE_COMMITMENT_BTN_CLS[c] : IDLE_COMMITMENT_BTN_CLS}
          >
            {COMMITMENT_LABEL[c]}
          </button>
        ))}
        {commitment && (
          <button type="button" onClick={() => setCommitment(playerId, null)} disabled={busy} className={DROP_OUT_BTN_CLS}>
            Drop out
          </button>
        )}
      </span>
      <ErrorText error={error} size={12} />
    </span>
  );
}
