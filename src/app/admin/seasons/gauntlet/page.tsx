import { redirect } from 'next/navigation';

// Folded into the unified admin console's Manage -> Season tab (issue #262). The manual pod editor
// (`/admin/seasons/gauntlet/manual/[id]`) is unaffected — it stays its own route.
export default function GauntletSeasonRedirect() {
  redirect('/admin?section=manage&type=season');
}
