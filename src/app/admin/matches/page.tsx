import { redirect } from 'next/navigation';

// Folded into the unified admin console's Manage -> Match tab (issue #262).
export default function ManageMatchesRedirect() {
  redirect('/admin?section=manage&type=match');
}
