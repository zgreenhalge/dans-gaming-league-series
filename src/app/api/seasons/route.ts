import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getAdminClient } from '@/lib/supabase-admin';
import { isPlayerAdmin } from '@/lib/queries';
import { extractSeasonNumber } from '@/lib/util';
import { mapSlug } from '@/lib/maps';

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

const WORKSHOP_URL_RE = /^https:\/\/steamcommunity\.com\/sharedfiles\/filedetails\/\?id=\d+/;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await isPlayerAdmin(session.user.playerId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabaseAdmin = getAdminClient();

  const body = await req.json().catch(() => null);
  const mapPool: string[] = Array.isArray(body?.map_pool) ? body.map_pool : [];
  const newMaps: NewMap[] = Array.isArray(body?.new_maps) ? body.new_maps : [];

  if (mapPool.length !== 5) {
    return NextResponse.json({ error: 'Exactly 5 maps are required' }, { status: 400 });
  }

  if (mapPool.some((m) => typeof m !== 'string' || !m.trim())) {
    return NextResponse.json({ error: 'Map pool entries must be non-empty strings' }, { status: 400 });
  }

  for (const m of newMaps) {
    if (!m.name?.trim() || !WORKSHOP_URL_RE.test(m.workshopUrl ?? '')) {
      return NextResponse.json({ error: 'New maps must have a name and valid Steam Workshop URL' }, { status: 400 });
    }
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

  const name = `Season ${maxNum + 1} Regular Season`;

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
