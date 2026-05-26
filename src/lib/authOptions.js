import { createClient } from "@supabase/supabase-js";
import CredentialsProvider from "next-auth/providers/credentials";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const devProvider = CredentialsProvider({
  id: "dev-steam-mock",
  name: "Dev Steam Mock",
  credentials: {
    steamId: { label: "Steam ID", type: "text" },
  },
  async authorize(credentials) {
    if (!credentials?.steamId) return null;
    return {
      id: credentials.steamId,
      name: credentials.steamId,
      image: "",
      steamId: String(credentials.steamId),
    };
  },
});

export const authOptions = {
  providers: [
    ...(process.env.NODE_ENV === "development" ? [devProvider] : []),
    {
      id: "steam",
      name: "Steam",
      type: "oauth",
      style: { logo: "/steam.svg", bg: "#000", text: "#fff" },
      clientId: "steam",
      clientSecret: process.env.STEAM_API_KEY,
      authorization: {
        url: "https://steamcommunity.com/openid/login",
        params: {
          "openid.mode": "checkid_setup",
          "openid.ns": "http://specs.openid.net/auth/2.0",
          "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
          "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
          "openid.return_to": `${process.env.NEXTAUTH_URL}/api/auth/callback/steam`,
          "openid.realm": process.env.NEXTAUTH_URL,
        },
      },
      token: {
        async request(context) {
          const params = context.checks.oauth?.searchParams;

          if (!params) {
            throw new Error("Missing Steam callback validation metadata.");
          }

          const verificationParams = new URLSearchParams(params);
          verificationParams.set("openid.mode", "check_authentication");

          const response = await fetch("https://steamcommunity.com/openid/login", {
            method: "POST",
            body: verificationParams,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
          });

          const responseText = await response.text();
          if (!responseText.includes("is_valid:true")) {
            throw new Error("Steam signature verification rejected.");
          }

          const claimedId = params.get("openid.claimed_id") || "";
          const steamId = claimedId.split("/").pop();

          return { tokens: { id_token: steamId, access_token: steamId } };
        },
      },
      userinfo: {
        async request(context) {
          const steamId = context.tokens.access_token;

          const response = await fetch(
            `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${context.provider.clientSecret}&steamids=${steamId}`
          );
          const data = await response.json();
          const player = data.response.players[0];

          return {
            id: steamId,
            name: player?.personaname || `Steam User ${steamId}`,
            image: player?.avatarfull || "",
          };
        },
      },
    },
  ],
  callbacks: {
    async jwt({ token, profile, user, trigger, session: sessionData }) {
      // profile is set on Steam OAuth login; user is set on credentials (dev mock) login
      const steamId = profile?.id ?? user?.steamId;
      if (steamId) {
        token.steamId = steamId;
        token.avatarUrl = profile?.image ?? "";

        const { data: player } = await supabase
          .from("players")
          .select("id, name")
          .eq("steam_id", String(steamId))
          .single();

        token.playerId = player?.id ?? null;
        token.playerName = player?.name ?? null;
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
