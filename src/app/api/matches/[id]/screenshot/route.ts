import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createClient } from '@supabase/supabase-js';
import { authOptions } from '@/lib/authOptions';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const matchId = Number(id);
  if (!Number.isFinite(matchId)) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const playerId = session.user.playerId;

  const [{ data: playerRow }, { data: matchStats }] = await Promise.all([
    supabaseAdmin.from('players').select('is_admin').eq('id', playerId).maybeSingle(),
    supabaseAdmin.from('player_match_stats').select('player_id').eq('match_id', matchId),
  ]);

  const isAdmin = !!(playerRow as { is_admin?: boolean } | null)?.is_admin;
  const isInMatch = (matchStats ?? []).some(
    (s: { player_id: number }) => s.player_id === playerId,
  );

  if (!isAdmin && !isInMatch) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = form.get('file');
  const side = form.get('side');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (side !== 'front' && side !== 'back') {
    return NextResponse.json({ error: 'side must be "front" or "back"' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'File must be JPEG, PNG, or WebP' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File must be under 10 MB' }, { status: 400 });
  }

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const storagePath = `${matchId}/${side}.${ext}`;
  const bytes = await file.arrayBuffer();

  const { error: uploadErr } = await supabaseAdmin.storage
    .from('match-screenshots')
    .upload(storagePath, bytes, { contentType: file.type, upsert: true });

  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { data: urlData } = supabaseAdmin.storage
    .from('match-screenshots')
    .getPublicUrl(storagePath);

  const column = side === 'front' ? 'screenshot_url_front' : 'screenshot_url_back';
  const { error: dbErr } = await supabaseAdmin
    .from('matches')
    .update({ [column]: urlData.publicUrl })
    .eq('id', matchId);

  if (dbErr) {
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  return NextResponse.json({ url: urlData.publicUrl });
}
