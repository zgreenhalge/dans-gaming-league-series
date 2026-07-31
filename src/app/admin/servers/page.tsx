import { redirect } from 'next/navigation';

// Folded into the unified admin console's standalone Server panel, always visible above Activity/
// Manage regardless of section (issue #262).
export default function AdminServersRedirect() {
  redirect('/admin');
}
