import { createClient } from "@supabase/supabase-js";
import CredentialsProvider from "next-auth/providers/credentials";
import { createHmac } from "crypto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
      const expected = createHmac("sha256", process.env.NEXTAUTH_SECRET)
        .update(`${steamId}:${expires}`)
        .digest("hex");
      if (sig !== expected) return null;

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
        const { data: player } = await supabase
          .from("players")
          .select("id, name")
          .eq("id", user.devPlayerId)
          .single();
        token.playerId = player?.id ?? null;
        token.playerName = player?.name ?? null;
      } else if (user?.steamId) {
        token.steamId = user.steamId;
        token.avatarUrl = user.image ?? "";

        const { data: player } = await supabase
          .from("players")
          .select("id, name")
          .eq("steam_id", String(user.steamId))
          .single();

        token.playerId = player?.id ?? null;
        token.playerName = player?.name ?? null;

        // Keep Steam profile info fresh in the DB on every login
        if (player) {
          await supabase
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

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.steamId = token.steamId;
        session.user.image = token.avatarUrl;
        session.user.playerId = token.playerId ?? null;
        session.user.playerName = token.playerName ?? null;
      }
      return session;
    },
  },
};
