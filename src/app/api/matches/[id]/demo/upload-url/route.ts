import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authOptions } from '@/lib/authOptions';
import { r2, R2_BUCKET, demoKey } from '@/lib/r2';
import { getAdminClient } from '@/lib/supabase-admin';

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
  const supabaseAdmin = getAdminClient();

  const [{ data: playerRow }, { data: matchStats }] = await Promise.all([
    supabaseAdmin.from('players').select('is_admin').eq('id', playerId).maybeSingle(),
    supabaseAdmin.from('player_match_stats').select('player_id').eq('match_id', matchId),
  ]);

  const isAdmin = !!(playerRow as { is_admin?: boolean } | null)?.is_admin;
  const isInMatch = (matchStats ?? []).some((s: { player_id: number }) => s.player_id === playerId);

  if (!isAdmin && !isInMatch) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const key = demoKey(matchId);
  const signedUrl = await getSignedUrl(
    r2,
    new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: 'application/octet-stream' }),
    { expiresIn: 3600 },
  );

  return NextResponse.json({ signedUrl, path: key });
}
