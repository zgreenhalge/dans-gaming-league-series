import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function requireUnlinkedSession(session) {
  if (!session?.user?.steamId) return { error: "Not authenticated", status: 401 };
  if (session.user.playerId != null) return { error: "Already registered", status: 400 };
  return null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const err = requireUnlinkedSession(session);
  if (err) return Response.json({ error: err.error }, { status: err.status });

  const { data: players, error } = await supabase
    .from("players")
    .select("id, name")
    .is("steam_id", null)
    .order("name");

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ players: players ?? [] });
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  const err = requireUnlinkedSession(session);
  if (err) return Response.json({ error: err.error }, { status: err.status });

  const steamId = String(session.user.steamId);
  const body = await request.json();

  // Link an existing player record
  if (body.existingPlayerId != null) {
    const { data: player, error } = await supabase
      .from("players")
      .update({ steam_id: steamId })
      .eq("id", body.existingPlayerId)
      .is("steam_id", null) // only link if still unlinked
      .select("id, name")
      .single();

    if (error || !player) {
      return Response.json({ error: "Could not link player — they may already be claimed." }, { status: 500 });
    }
    return Response.json({ playerId: player.id, playerName: player.name });
  }

  // Create a new player record
  const trimmedName = body.name?.trim();
  if (!trimmedName) return Response.json({ error: "Name is required" }, { status: 400 });

  const { data: player, error } = await supabase
    .from("players")
    .insert({ name: trimmedName, steam_id: steamId })
    .select("id, name")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ playerId: player.id, playerName: player.name });
}
