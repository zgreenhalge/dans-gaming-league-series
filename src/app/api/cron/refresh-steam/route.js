import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: players, error: fetchError } = await supabase
    .from("players")
    .select("id, steam_id")
    .not("steam_id", "is", null);

  if (fetchError) {
    return Response.json({ error: fetchError.message }, { status: 500 });
  }

  if (!players?.length) {
    return Response.json({ updated: 0 });
  }

  // Steam API accepts up to 100 steamids per request
  const BATCH = 100;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < players.length; i += BATCH) {
    const batch = players.slice(i, i + BATCH);
    const steamIds = batch.map((p) => p.steam_id).join(",");

    let profiles;
    try {
      const res = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${process.env.STEAM_API_KEY}&steamids=${steamIds}`
      );
      const data = await res.json();
      profiles = data.response?.players ?? [];
    } catch {
      failed += batch.length;
      continue;
    }

    const profileMap = Object.fromEntries(profiles.map((p) => [p.steamid, p]));

    for (const player of batch) {
      const profile = profileMap[player.steam_id];
      if (!profile) {
        failed++;
        continue;
      }

      const { error } = await supabase
        .from("players")
        .update({
          steam_nickname: profile.personaname ?? null,
          steam_avatar_url: profile.avatarfull ?? null,
        })
        .eq("id", player.id);

      if (error) {
        failed++;
      } else {
        updated++;
      }
    }
  }

  return Response.json({ updated, failed });
}
