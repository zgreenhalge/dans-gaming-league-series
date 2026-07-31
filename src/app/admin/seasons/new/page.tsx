import { redirect } from 'next/navigation';

// Folded into the unified admin console's Manage -> Season tab (issue #262).
export default function NewSeasonRedirect() {
  redirect('/admin?section=manage&type=season');
}
