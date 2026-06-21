import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getAdminClient } from '@/lib/supabase-admin';
import { extractSeasonNumber } from '@/lib/util';
import { mapSlug } from '@/lib/maps';

const supabaseAdmin = getAdminClient();

type NewMap = { name: string; workshopUrl: string };

function extractWorkshopId(url: string): string | null {
  const match = url.match(/[?&]id=(\d+)/);
  return match ? match[1] : null;
}

async function fetchWorkshopPreviewImage(workshopUrl: string): Promise<string | null> {
  const fileId = extractWorkshopId(workshopUrl);
  if (!fileId) return null;
  try {
    const res = await fetch(
      'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `itemcount=1&publishedfileids[0]=${fileId}`,
      },
    );
    const data = await res.json();
    const detail = data?.response?.publishedfiledetails?.[0];
    return detail?.preview_url ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: playerRow } = await supabaseAdmin
    .from('players')
    .select('is_admin')
    .eq('id', session.user.playerId)
    .maybeSingle();

  if (!(playerRow as { is_admin?: boolean } | null)?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const mapPool: string[] = Array.isArray(body?.map_pool) ? body.map_pool : [];
  const newMaps: NewMap[] = Array.isArray(body?.new_maps) ? body.new_maps : [];

  if (mapPool.length !== 5) {
    return NextResponse.json({ error: 'Exactly 5 maps are required' }, { status: 400 });
  }

  const { data: seasons, error: fetchErr } = await supabaseAdmin
    .from('seasons')
    .select('name')
    .eq('is_gauntlet', false);

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  let maxNum = 0;
  for (const s of seasons ?? []) {
    const n = extractSeasonNumber((s as { name: string }).name);
    if (n !== null && n > maxNum) maxNum = n;
  }

  const name = `Season ${maxNum + 1}`;

  // Upsert new maps into the maps table, fetching preview images from Steam
  if (newMaps.length > 0) {
    const rows = await Promise.all(
      newMaps.map(async (m) => {
        const previewUrl = await fetchWorkshopPreviewImage(m.workshopUrl);
        return {
          name: m.name.trim().toLowerCase(),
          slug: mapSlug(m.name),
          workshop_url: m.workshopUrl,
          image_url: previewUrl,
        };
      }),
    );
    const { error: mapErr } = await supabaseAdmin
      .from('maps')
      .upsert(rows, { onConflict: 'slug' });
    if (mapErr) {
      return NextResponse.json({ error: mapErr.message }, { status: 500 });
    }
  }

  const { data: created, error: insertErr } = await supabaseAdmin
    .from('seasons')
    .insert({
      name,
      status: 'UPCOMING',
      is_gauntlet: false,
      map_pool: mapPool,
      target_win_rounds: 13,
    })
    .select('*')
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json(created, { status: 201 });
}
