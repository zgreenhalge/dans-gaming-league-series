import { NextResponse } from "next/server";
import { createHmac } from "crypto";

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  // Validate the OpenID response with Steam
  const verificationParams = new URLSearchParams(searchParams);
  verificationParams.set("openid.mode", "check_authentication");

  const verifyResponse = await fetch("https://steamcommunity.com/openid/login", {
    method: "POST",
    body: verificationParams,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const verifyText = await verifyResponse.text();
  if (!verifyText.includes("is_valid:true")) {
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/?error=steam_invalid`);
  }

  const claimedId = searchParams.get("openid.claimed_id") ?? "";
  const steamId = claimedId.split("/").pop();
  if (!steamId) {
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/?error=steam_invalid`);
  }

  // Create a short-lived signed token so the client can complete the credentials sign-in
  const expires = Date.now() + 60_000; // 1 minute
  const payload = `${steamId}:${expires}`;
  const sig = createHmac("sha256", process.env.NEXTAUTH_SECRET)
    .update(payload)
    .digest("hex");
  const token = Buffer.from(JSON.stringify({ steamId, expires, sig })).toString("base64url");

  return NextResponse.redirect(
    `${process.env.NEXTAUTH_URL}/auth/steam?token=${token}`
  );
}
