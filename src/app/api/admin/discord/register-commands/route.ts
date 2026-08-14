// Manually trigger Discord slash-command registration (#396) from the admin console — the same PUT
// scripts/register-discord-commands.ts makes, for registering against the production bot from an
// environment (e.g. mobile) that can't run the script locally with DISCORD_APPLICATION_ID/
// DISCORD_BOT_TOKEN sourced from .env.local.

import { NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { registerDiscordCommands } from '@/lib/discord-command-registration';

export async function POST() {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const result = await registerDiscordCommands();
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });

  return NextResponse.json({ ok: true, names: result.names });
}
