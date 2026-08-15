import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getAdminClient } from "@/lib/supabase-admin";
import { deleteNameRole } from "@/lib/discord-roles";
import { afterBestEffort } from "@/lib/after";

// Self-service Discord unlink (#394) — clears the caller's own players.discord_id. Linking itself
// goes through the OAuth2 redirect flow (/api/auth/discord/link + callback); unlinking needs no
// round trip to Discord, so it's a plain authenticated DELETE, same auth pattern as
// PATCH /api/players/me/name.
//
// This never touches @Participants: the role tracks active-season roster membership, not whether a
// Discord account happens to be linked right now. A player can be rostered and participating without
// ever linking Discord, so unlinking has no reason to revoke it. The name-color role is the opposite
// case — it only makes sense while linked, so unlinking deletes it (players.discord_name_role_id is
// read before the update, since the role id is gone from the row the moment it's cleared).

export async function DELETE() {
  // Resolved per-request, not at module scope, so a test can inject a fresh fake client (getAdminClient()
  // resolves once at import time otherwise, before any override could take effect).
  const supabaseAdmin = getAdminClient();

  const session = await requireSession();
  const playerId = session?.user?.playerId;
  if (!playerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: current } = await supabaseAdmin
    .from("players")
    .select("discord_name_role_id")
    .eq("id", playerId)
    .maybeSingle();
  const nameRoleId = (current as { discord_name_role_id: string | null } | null)?.discord_name_role_id ?? null;

  const { error } = await supabaseAdmin
    .from("players")
    .update({ discord_id: null, discord_name_role_id: null })
    .eq("id", playerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (nameRoleId) {
    afterBestEffort(`discord-roles: delete name role for self-unlinked player ${playerId}`, () =>
      deleteNameRole(supabaseAdmin, playerId, nameRoleId),
    );
  }

  return NextResponse.json({ ok: true });
}
