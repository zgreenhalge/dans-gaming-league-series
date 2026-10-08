import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { error } = await getAdminClient().from('players').select('id').limit(1);

  if (error) {
    return NextResponse.json({ status: 'error', message: error.message }, { status: 503 });
  }

  return NextResponse.json({ status: 'ok' });
}
