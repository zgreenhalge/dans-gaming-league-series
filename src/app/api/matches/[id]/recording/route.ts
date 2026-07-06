import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from '@/lib/supabase-admin';


const supabaseAdmin = getAdminClient();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matchId = Number(id);
  const value = await request.json()

  const { error } = await supabaseAdmin
    .from("matches")
    .update({ recording_url: value.value })
    .eq("id", matchId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}