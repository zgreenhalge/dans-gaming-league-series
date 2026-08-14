import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getAdminClient } from "@/lib/supabase-admin";

// Self-service Discord unlink (#394) — clears the caller's own players.discord_id. Linking itself
// goes through the OAuth2 redirect flow (/api/auth/discord/link + callback); unlinking needs no
// round trip to Discord, so it's a plain authenticated DELETE, same auth pattern as
// PATCH /api/players/me/name.
//
// This never touches @Participants: the role tracks active-season roster membership, not whether a
// Discord account happens to be linked right now. A player can be rostered and participating without
// ever linking Discord, so unlinking has no reason to revoke it.

export async function DELETE() {
  // Resolved per-request, not at module scope, so a test can inject a fresh fake client (getAdminClient()
  // resolves once at import time otherwise, before any override could take effect).
  const supabaseAdmin = getAdminClient();

  const session = await requireSession();
  const playerId = session?.user?.playerId;
  if (!playerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabaseAdmin
    .from("players")
    .update({ discord_id: null })
    .eq("id", playerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
