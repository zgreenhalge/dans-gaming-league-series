import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.steamId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (session.user.playerId != null) {
    return Response.json({ error: "Already registered" }, { status: 400 });
  }

  const { name } = await request.json();
  const trimmedName = name?.trim();
  if (!trimmedName) {
    return Response.json({ error: "Name is required" }, { status: 400 });
  }

  const { data: player, error } = await supabase
    .from("players")
    .insert({ name: trimmedName, steam_id: String(session.user.steamId) })
    .select("id, name")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ playerId: player.id, playerName: player.name });
}
