import { redirect } from 'next/navigation';

// Folded into the unified admin console's Manage -> Player tab (issue #262).
export default function ManagePlayersRedirect() {
  redirect('/admin?section=manage&type=player');
}
