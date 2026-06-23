import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";


export async function POST(request: NextRequest) {
  const { matchId, value } = await request.json();

  const { error } = await supabase
    .from("matches")
    .update({ recording_url: value })
    .eq("id", matchId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}