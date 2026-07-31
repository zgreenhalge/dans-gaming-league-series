import { redirect } from 'next/navigation';

// Folded into the unified admin console's Activity -> Errored tab (issue #262) — merged with failed
// background jobs rather than living on its own page.
export default function OpsErrorsRedirect() {
  redirect('/admin?section=activity');
}
