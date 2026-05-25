import { redirect } from 'next/navigation';

export default function PlayersRedirect() {
  redirect('/statistics');
}
