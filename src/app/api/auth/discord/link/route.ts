import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { signDiscordLinkState } from "@/lib/discordLinkState";

// Starts the Discord account-linking OAuth2 flow (#394) for the signed-in player. This links an
// already-authenticated DGLS account to a Discord user id (players.discord_id) — distinct from
// Steam's OpenID flow, which establishes the session itself; linking here never touches the
// session or JWT.
export async function GET() {
  const session = await requireSession();
  const playerId = session?.user?.playerId;
  if (!playerId) {
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/?error=discord_unauthenticated`);
  }
  if (!process.env.DISCORD_CLIENT_ID) {
    console.error("[discord/link] DISCORD_CLIENT_ID is not set");
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/?error=config`);
  }

  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/discord/callback`;
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify",
    state: signDiscordLinkState(playerId),
    prompt: "consent",
  });
  return NextResponse.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
}
