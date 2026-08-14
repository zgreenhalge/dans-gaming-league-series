/**
 * The `players.discord_id` uniqueness check — shared by the two routes that can set it
 * (`GET /api/auth/discord/callback`, the self-service OAuth flow; `PATCH /api/players/[id]`, the
 * admin override) so they can't drift on what counts as "already linked."
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export async function isDiscordIdTaken(
  supabaseAdmin: SupabaseClient,
  discordId: string,
  excludePlayerId: number,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('players')
    .select('id')
    .eq('discord_id', discordId)
    .neq('id', excludePlayerId)
    .maybeSingle();
  // Fail closed: a query error must not read the same as "not taken", or a transient failure
  // here would let a duplicate discord_id slip through the write it's meant to guard.
  if (error) throw error;
  return !!data;
}
