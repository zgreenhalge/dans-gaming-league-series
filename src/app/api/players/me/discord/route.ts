import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { getAdminClient } from "@/lib/supabase-admin";

// Self-service Discord unlink (#394) — clears the caller's own players.discord_id. Linking itself
// goes through the OAuth2 redirect flow (/api/auth/discord/link + callback); unlinking needs no
// round trip to Discord, so it's a plain authenticated DELETE, same auth pattern as
// PATCH /api/players/me/name.

const supabaseAdmin = getAdminClient();

export async function DELETE() {
  const session = await getServerSession(authOptions);
  const playerId = session?.user?.playerId;
  if (!playerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabaseAdmin
    .from("players")
    .update({ discord_id: null })
    .eq("id", playerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
