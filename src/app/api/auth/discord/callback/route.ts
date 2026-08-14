import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase-admin";
import { verifyDiscordLinkState } from "@/lib/discordLinkState";
import { isDiscordIdTaken } from "@/lib/discord-link";

// Completes the Discord account-linking OAuth2 flow (#394) started by /api/auth/discord/link:
// exchanges the auth code for a token, reads the caller's Discord user id via /users/@me, and
// writes it to players.discord_id for the player named in the signed `state` param. Every outcome
// (success, denial, config error, id already linked elsewhere) redirects back to that player's own
// profile with a `?discord=` status the page reads to show feedback.

const supabaseAdmin = getAdminClient();

function redirectToProfile(playerId: number, status: string) {
  return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/players/${playerId}?discord=${status}`);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const err = searchParams.get("error");

  const verified = state ? verifyDiscordLinkState(state) : null;
  if (!verified) {
    // No player to redirect back to without a valid state — this is the one failure mode that
    // can't land on a profile page.
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/?error=discord_bad_state`);
  }
  const { playerId } = verified;

  if (err || !code) {
    // User denied consent, or Discord returned an error — not a failure worth logging.
    return redirectToProfile(playerId, "denied");
  }

  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    console.error("[discord/callback] DISCORD_CLIENT_ID/DISCORD_CLIENT_SECRET is not set");
    return redirectToProfile(playerId, "error");
  }

  try {
    const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/discord/callback`;
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) return redirectToProfile(playerId, "error");
    const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string };
    if (!accessToken) return redirectToProfile(playerId, "error");

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) return redirectToProfile(playerId, "error");
    const discordUser = (await userRes.json()) as { id?: string };
    if (!discordUser.id) return redirectToProfile(playerId, "error");

    // discord_id must be unique — a duplicate would make role sync and @mentions ambiguous.
    if (await isDiscordIdTaken(supabaseAdmin, discordUser.id, playerId)) {
      return redirectToProfile(playerId, "taken");
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("players")
      .update({ discord_id: discordUser.id })
      .eq("id", playerId)
      .select("id")
      .maybeSingle();
    // No matching row (e.g. the player was deleted mid-flow) isn't a Supabase `error` — check
    // explicitly rather than reporting "linked" for a write that touched nothing.
    if (updateError || !updated) return redirectToProfile(playerId, "error");

    return redirectToProfile(playerId, "linked");
  } catch (e) {
    console.error("[discord/callback] unhandled error:", e);
    return redirectToProfile(playerId, "error");
  }
}
