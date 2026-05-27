import { NextResponse } from "next/server";

export function GET() {
  const callbackUrl = `${process.env.NEXTAUTH_URL}/api/auth/steam/callback`;
  const params = new URLSearchParams({
    "openid.mode": "checkid_setup",
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.return_to": callbackUrl,
    "openid.realm": process.env.NEXTAUTH_URL,
  });
  return NextResponse.redirect(
    `https://steamcommunity.com/openid/login?${params}`
  );
}
