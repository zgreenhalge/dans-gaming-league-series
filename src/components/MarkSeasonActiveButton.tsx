'use client';

import { ArmedConfirmButton } from './ArmedConfirmButton';
import { ActivationWarning, useActivateSeason } from './useActivateSeason';

interface Props {
  seasonId: number;
  seasonStatus: string;
}

/** Manual "go live" for a regular season (`useActivateSeason()`) as a button that arms before firing
 * (there's no undo in the UI), for the admin console's season list. The season page puts the same
 * action in its admin menu (`SeasonSetupDetails`). */
export default function MarkSeasonActiveButton({ seasonId, seasonStatus }: Props) {
  const { activate, busy, error, warning } = useActivateSeason(seasonId);

  // Keep showing the warning even after refresh flips seasonStatus away from UPCOMING — it's the
  // only place this failure is visible, since activation itself succeeded.
  if (warning) return <ActivationWarning warning={warning} />;
  if (seasonStatus !== 'UPCOMING') return null;

  return (
    <ArmedConfirmButton
      onConfirm={activate}
      busy={busy}
      error={error}
      triggerLabel="Mark Active"
      confirmLabel="Confirm Go Live"
      busyLabel="Activating…"
      variant="primary"
    />
  );
}
