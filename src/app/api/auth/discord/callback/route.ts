import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase-admin";
import { verifyDiscordLinkState } from "@/lib/discordLinkState";
import { isDiscordIdTaken } from "@/lib/discord-link";
import { recordOpsError, clearOpsError } from "@/lib/ops-errors";

// Completes the Discord account-linking OAuth2 flow (#394) started by /api/auth/discord/link:
// exchanges the auth code for a token, reads the caller's Discord user id via /users/@me, and
// writes it to players.discord_id for the player named in the signed `state` param. Every outcome
// (success, denial, config error, id already linked elsewhere) redirects back to that player's own
// profile with a `?discord=` status the page reads to show feedback — that's enough visibility for
// the one player it happened to, but not for an admin: if the flow breaks systemically (e.g. a
// rotated DISCORD_CLIENT_SECRET), every affected player would just see "something went wrong" and
// quietly give up, with nothing surfaced anywhere an admin would look. A genuine failure (not the
// expected "denied"/"taken" outcomes) is recorded to ops_errors — operation 'discord_link' — so a
// pattern of these becomes visible in the admin console's Activity feed.

function redirectToProfile(playerId: number, status: string) {
  return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/players/${playerId}?discord=${status}`);
}

export async function GET(request: Request) {
  // Resolved per-request (not at module scope) so a test can inject a fresh fake client — see the
  // score/players routes' own `const supabaseAdmin = getAdminClient()` placement for the same reason.
  const supabaseAdmin = getAdminClient();

  /** A genuine failure, as opposed to the expected "denied"/"taken" outcomes below — recorded so an
   *  admin can see a pattern of these, not just the one player who hit this instance of it. */
  async function redirectWithError(playerId: number, message: string) {
    await recordOpsError(supabaseAdmin, "player", playerId, "discord_link", message);
    return redirectToProfile(playerId, "error");
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const err = searchParams.get("error");

  const verified = state ? verifyDiscordLinkState(state) : null;
  if (!verified) {
    // No player to redirect back to without a valid state — this is the one failure mode that
    // can't land on a profile page, and not one to attribute to a specific player either (an
    // expired/tampered state is the expected shape of a stale or replayed callback, not a system
    // fault worth an ops_errors entry).
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/?error=discord_bad_state`);
  }
  const { playerId } = verified;

  if (err || !code) {
    // User denied consent, or Discord returned an error — not a failure worth logging.
    return redirectToProfile(playerId, "denied");
  }

  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    // Config issues are system-wide, not this one player's — 0/'system' matches the convention
    // used elsewhere (e.g. the EHOG recompute) for operations with no single entity.
    await recordOpsError(supabaseAdmin, "system", 0, "discord_link", "DISCORD_CLIENT_ID/DISCORD_CLIENT_SECRET is not set");
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
    if (!tokenRes.ok) return redirectWithError(playerId, `Token exchange returned ${tokenRes.status}`);
    const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string };
    if (!accessToken) return redirectWithError(playerId, "Token exchange returned no access_token");

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) return redirectWithError(playerId, `/users/@me returned ${userRes.status}`);
    const discordUser = (await userRes.json()) as { id?: string };
    if (!discordUser.id) return redirectWithError(playerId, "/users/@me returned no id");

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
    if (updateError) {
      // The DB's own players_discord_id_key constraint is the backstop for the isDiscordIdTaken()
      // check above racing a concurrent link attempt for the same Discord account — report it the
      // same way as a check that caught it up front, not as a logged failure.
      if ((updateError as { code?: string }).code === "23505") return redirectToProfile(playerId, "taken");
      return redirectWithError(playerId, `players update failed: ${updateError.message}`);
    }
    // No matching row (e.g. the player was deleted mid-flow) isn't a Supabase `error` — check
    // explicitly rather than reporting "linked" for a write that touched nothing.
    if (!updated) return redirectWithError(playerId, "players update matched no row");

    await clearOpsError(supabaseAdmin, "player", playerId, "discord_link");
    return redirectToProfile(playerId, "linked");
  } catch (e) {
    return redirectWithError(playerId, `unhandled error: ${(e as Error).message}`);
  }
}
