import { redirect } from 'next/navigation';

// Folded into the unified admin console's Activity tab (issue #262).
export default function BackgroundJobsRedirect() {
  redirect('/admin?section=activity');
}
