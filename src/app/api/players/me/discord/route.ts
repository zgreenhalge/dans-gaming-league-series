import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getAdminClient } from "@/lib/supabase-admin";
import { revokeParticipantRole } from "@/lib/discord-roles";
import { afterBestEffort } from "@/lib/after";

// Self-service Discord unlink (#394) — clears the caller's own players.discord_id. Linking itself
// goes through the OAuth2 redirect flow (/api/auth/discord/link + callback); unlinking needs no
// round trip to Discord, so it's a plain authenticated DELETE, same auth pattern as
// PATCH /api/players/me/name.

export async function DELETE() {
  // Resolved per-request, not at module scope, so a test can inject a fresh fake client (getAdminClient()
  // resolves once at import time otherwise, before any override could take effect).
  const supabaseAdmin = getAdminClient();

  const session = await requireSession();
  const playerId = session?.user?.playerId;
  if (!playerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Read the current discord_id before clearing it -- it's the one thing revokeParticipantRole()
  // needs, and there's nothing left to revoke against once the column is null.
  const { data: player } = await supabaseAdmin.from("players").select("discord_id").eq("id", playerId).maybeSingle();
  const discordId = (player as { discord_id: string | null } | null)?.discord_id ?? null;

  const { error } = await supabaseAdmin
    .from("players")
    .update({ discord_id: null })
    .eq("id", playerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  afterBestEffort(`discord-roles: revoke @Participants from unlinked player ${playerId}`, () =>
    revokeParticipantRole(supabaseAdmin, playerId, discordId),
  );

  return NextResponse.json({ ok: true });
}
