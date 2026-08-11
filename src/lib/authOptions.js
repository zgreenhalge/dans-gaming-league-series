import { createClient } from "@supabase/supabase-js";
import CredentialsProvider from "next-auth/providers/credentials";
import { hmacVerify } from "./hmacSign";

// Built lazily (not at module load) so merely importing authOptions — e.g. via a route's session
// gate — doesn't require real Supabase env vars to be set. Mirrors the getClient()/getAdminClient()
// lazy-init pattern in supabase.ts/supabase-admin.ts.
let _supabase;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _supabase;
}

async function fetchSteamProfile(steamId) {
  const res = await fetch(
    `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${process.env.STEAM_API_KEY}&steamids=${steamId}`
  );
  const data = await res.json();
  const player = data.response?.players?.[0];
  return {
    name: player?.personaname || `Steam User ${steamId}`,
    image: player?.avatarfull || "",
  };
}

const steamProvider = CredentialsProvider({
  id: "steam-credentials",
  name: "Steam",
  credentials: { token: { type: "text" } },
  async authorize(credentials) {
    if (!credentials?.token) return null;
    try {
      const { steamId, expires, sig } = JSON.parse(
        Buffer.from(credentials.token, "base64url").toString()
      );
      if (Date.now() > expires) return null;
      if (!hmacVerify(`${steamId}:${expires}`, sig)) return null;

      const { name, image } = await fetchSteamProfile(steamId);
      return { id: steamId, name, image, steamId };
    } catch {
      return null;
    }
  },
});

const devZachProvider = CredentialsProvider({
  id: "dev-zach-mock",
  name: "Dev: Zach",
  credentials: {},
  async authorize() {
    return { id: "dev-1", name: "Zach", image: "", devPlayerId: 1 };
  },
});

const devDanProvider = CredentialsProvider({
  id: "dev-dan-mock",
  name: "Dev: Dan",
  credentials: {},
  async authorize() {
    return { id: "dev-7", name: "Dan", image: "", devPlayerId: 7 };
  },
});

export const authOptions = {
  providers: [
    steamProvider,
    ...(process.env.NODE_ENV === "development" ? [devZachProvider, devDanProvider] : []),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session: sessionData }) {
      // user is populated on first sign-in for credentials providers
      if (user?.devPlayerId) {
        const { data: player } = await getSupabase()
          .from("players")
          .select("id, name, is_admin")
          .eq("id", user.devPlayerId)
          .single();
        token.playerId = player?.id ?? null;
        token.playerName = player?.name ?? null;
        token.isAdmin = !!player?.is_admin;
      } else if (user?.steamId) {
        token.steamId = user.steamId;
        token.avatarUrl = user.image ?? "";

        const { data: player } = await getSupabase()
          .from("players")
          .select("id, name, is_admin")
          .eq("steam_id", String(user.steamId))
          .single();

        token.playerId = player?.id ?? null;
        token.playerName = player?.name ?? null;
        token.isAdmin = !!player?.is_admin;

        // Keep Steam profile info fresh in the DB on every login
        if (player) {
          await getSupabase()
            .from("players")
            .update({
              steam_nickname: user.name,
              steam_avatar_url: user.image,
            })
            .eq("id", player.id);
        }
      }

      if (trigger === "update" && sessionData?.playerId != null) {
        // Called after successful registration to refresh player info in the token
        token.playerId = sessionData.playerId;
        token.playerName = sessionData.playerName;
      }

      // The jwt callback runs on every request that touches the session (e.g. the client Topbar's
      // useSession), so re-deriving is_admin here on every read — rather than caching it for the
      // JWT's lifetime — is what makes an admin demotion (or promotion) take effect on that player's
      // very next request. Skipped when the sign-in branches above already fetched it fresh this
      // call, to avoid querying twice. Left untouched on a query error, so a transient DB failure
      // can't silently strip an admin's access.
      const freshlyComputed = user?.devPlayerId != null || user?.steamId != null;
      if (!freshlyComputed && token.playerId != null) {
        const { data: p, error } = await getSupabase()
          .from("players")
          .select("is_admin")
          .eq("id", token.playerId)
          .maybeSingle();
        if (!error) {
          token.isAdmin = !!p?.is_admin;
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.steamId = token.steamId;
        session.user.image = token.avatarUrl;
        session.user.playerId = token.playerId ?? null;
        session.user.playerName = token.playerName ?? null;
        session.user.isAdmin = !!token.isAdmin;
      }
      return session;
    },
  },
};
