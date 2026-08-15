// Manually trigger the Discord name-role backfill from the admin console — the same call
// scripts/backfill-discord-name-roles.ts makes, for running it against the production bot from an
// environment (e.g. mobile) that can't run the script locally with DISCORD_BOT_TOKEN/
// DISCORD_GUILD_ID sourced from .env.local.

import { NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { backfillNameRoles } from '@/lib/discord-roles';

export async function POST() {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const result = await backfillNameRoles(getAdminClient());
  return NextResponse.json({ ok: true, attempted: result.attempted });
}
