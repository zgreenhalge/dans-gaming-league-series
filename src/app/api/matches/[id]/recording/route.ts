import { NextRequest, NextResponse } from "next/server";
import { requireMatchAccess } from "@/lib/match-access";
import { accessDenied } from "@/lib/access-control";
import { getAdminClient } from "@/lib/supabase-admin";
import { setMatchRecording } from "@/lib/match-day";
import { parseRouteId } from "@/lib/util";
import { writeFailed } from '@/lib/access-control';

// Set or clear a match's recording_url. Editable by admins and in-match players — the same
// gate the score route uses, since a recording is part of a match's result.

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matchId = parseRouteId(id);
  if (matchId === null) {
    return NextResponse.json({ error: "Invalid match ID" }, { status: 400 });
  }

  const access = await requireMatchAccess(matchId);
  if (!access.ok) return accessDenied(access);

  const supabaseAdmin = getAdminClient();

  const body = await request.json().catch(() => null);
  if (!body || (body.value !== null && typeof body.value !== "string")) {
    return NextResponse.json({ error: "Missing string|null value" }, { status: 400 });
  }

  try {
    if (!(await setMatchRecording(supabaseAdmin, matchId, body.value))) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }
  } catch (err) {
    return writeFailed(err, "Saving the recording failed");
  }
  return NextResponse.json({ success: true });
}
