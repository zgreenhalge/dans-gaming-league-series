import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { getAdminClient } from "@/lib/supabase-admin";
import { parseMatchId } from "@/lib/util";

// Set or clear a match's recording_url. Editable by admins and in-match players — the same
// gate the score route uses, since a recording is part of a match's result.

const supabaseAdmin = getAdminClient();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const playerId = session?.user?.playerId;
  if (!playerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const matchId = parseMatchId(id);
  if (matchId === null) {
    return NextResponse.json({ error: "Invalid match ID" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || (body.value !== null && typeof body.value !== "string")) {
    return NextResponse.json({ error: "Missing string|null value" }, { status: 400 });
  }

  const [{ data: playerRow }, { data: matchStats }] = await Promise.all([
    supabaseAdmin.from("players").select("is_admin").eq("id", playerId).maybeSingle(),
    supabaseAdmin.from("player_match_stats").select("player_id").eq("match_id", matchId),
  ]);

  const isAdmin = !!(playerRow as { is_admin?: boolean } | null)?.is_admin;
  const isInMatch = ((matchStats ?? []) as { player_id: number }[]).some(
    (s) => s.player_id === playerId,
  );
  if (!isAdmin && !isInMatch) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabaseAdmin
    .from("matches")
    .update({ recording_url: body.value })
    .eq("id", matchId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
