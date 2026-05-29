import { createClient } from '@supabase/supabase-js';
import type { Player } from './types';

const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function fetchSteamProfile(steamId: string): Promise<{ name: string; image: string } | null> {
  try {
    const res = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${process.env.STEAM_API_KEY}&steamids=${steamId}`,
      { next: { revalidate: 0 } },
    );
    const data = await res.json();
    const player = data.response?.players?.[0];
    if (!player) return null;
    return { name: player.personaname, image: player.avatarfull ?? '' };
  } catch {
    return null;
  }
}

/**
 * If the player has a steam_id and their Steam data is older than 5 minutes,
 * fetches fresh data from the Steam API and writes it back to the DB.
 * Returns the updated fields, or null if no refresh was needed/possible.
 */
export async function maybeRefreshSteamProfile(
  player: Player,
): Promise<{ steam_nickname: string; steam_avatar_url: string } | null> {
  if (!player.steam_id) return null;

  const lastRefresh = player.steam_refreshed_at ? new Date(player.steam_refreshed_at).getTime() : 0;
  if (Date.now() - lastRefresh < REFRESH_COOLDOWN_MS) return null;

  const profile = await fetchSteamProfile(player.steam_id);
  if (!profile) return null;

  await supabaseAdmin
    .from('players')
    .update({
      steam_nickname: profile.name,
      steam_avatar_url: profile.image,
      steam_refreshed_at: new Date().toISOString(),
    })
    .eq('id', player.id);

  return { steam_nickname: profile.name, steam_avatar_url: profile.image };
}
