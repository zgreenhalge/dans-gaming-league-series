// src/auth.js
import NextAuth from "next-auth";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    {
      id: "steam",
      name: "Steam",
      type: "oauth", // Auth.js processes custom OpenID strings via the OAuth type framework
      style: { logo: "/steam.svg", bg: "#000", text: "#fff" },
      clientId: "steam", // Fallback required placeholder string
      clientSecret: process.env.STEAM_API_KEY, // Your actual Steam API Key
      authorization: {
        url: "https://steamcommunity.com/openid/login",
        params: {
          "openid.mode": "checkid_setup",
          "openid.ns": "http://specs.openid.net/auth/2.0",
          "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
          "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
        },
      },
      token: {
        async request(context) {
          // This intercepts Steam's redirect parameters to validate the transaction signature
          const u = new URL(context.provider.callbackUrl);
          const params = context.checks.oauth?.searchParams;

          if (!params) {
            throw new Error("Missing Steam callback validation metadata.");
          }

          // 1. Send signature parameters back to Steam's verification server
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

          // 2. Extract the unique 64-bit Steam ID from the claimed_id string parameter
          const claimedId = params.get("openid.claimed_id") || "";
          const steamId = claimedId.split("/").pop();

          return { tokens: { id_token: steamId, access_token: steamId } };
        },
      },
      userinfo: {
        async request(context) {
          const steamId = context.tokens.access_token;

          // 3. Query the official Web API to grab profile names and high-res avatars
          const response = await fetch(
            `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${context.provider.clientSecret}&steamids=${steamId}`
          );
          const data = await response.json();
          const player = data.response.players[0];

          return {
            id: steamId,
            name: player?.personaname || `Steam User ${steamId}`,
            image: player?.avatarfull || "",
            steamId: steamId,
          };
        },
      },
    },
  ],
  callbacks: {
    // Check your manual database updates when someone logs in
    async signIn({ profile }) {
      const steamId = profile?.id;
      if (!steamId) return false;

      const { data: player, error } = await supabase
        .from('players')
        .select('*')
        .eq('steam_id', String(steamId))
        .single();

      if (error || !player) {
        console.warn(`Access denied for Steam ID: ${steamId} (Not on Roster)`);
        return false; // Blocks access to unlisted logins
      }

      return true; // Valid roster member!
    },

    async jwt({ token, profile }) {
      if (profile) {
        token.steamId = profile.id;
        token.avatarUrl = profile.image;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.steamId = token.steamId;
        session.user.image = token.avatarUrl;
      }
      return session;
    }
  }
});

// Exporting these specifically to be consumed by route.js
export const { GET, POST } = handlers;
export { auth, signIn, signOut };