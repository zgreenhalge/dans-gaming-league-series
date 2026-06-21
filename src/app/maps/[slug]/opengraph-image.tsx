import { ImageResponse } from 'next/og';
import { getMapDetail } from '@/lib/queries';
import { toSentenceCase, mapImageFor } from '@/lib/maps';
import { OG_SIZE, colors, loadFonts, fontConfig, CardShell, StatPill, loadMapImageAsDataUri } from '@/lib/og-card';

export const alt = 'DGLS Map';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const revalidate = 60;

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [detail, fonts] = await Promise.all([
    getMapDetail(slug),
    loadFonts(),
  ]);

  if (!detail) {
    return new ImageResponse(
      <CardShell><div style={{ fontSize: '48px', fontWeight: 600 }}>Map not found</div></CardShell>,
      { ...size, fonts: fontConfig(fonts) },
    );
  }

  const name = toSentenceCase(detail.name);
  const regularSeasons = detail.seasons.filter(s => !s.is_gauntlet);
  const totalMatches = detail.matches.length;

  const mapRelPath = mapImageFor(detail.name);
  const bgImage = mapRelPath ? await loadMapImageAsDataUri(mapRelPath) : null;

  return new ImageResponse(
    (
      <CardShell subtitle="Map" bgImage={bgImage ?? undefined}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'flex-end' }}>
          <span style={{ fontSize: '84px', fontWeight: 600, marginBottom: '8px' }}>
            {name}
          </span>

          {regularSeasons.length > 0 && (
            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
              {regularSeasons.map(s => (
                <span
                  key={s.id}
                  style={{
                    fontFamily: 'JetBrains Mono',
                    fontSize: '22px',
                    padding: '4px 14px',
                    border: `1px solid ${colors.BORDER}`,
                    color: colors.TEXT2,
                    backgroundColor: 'rgba(22,26,33,0.8)',
                  }}
                >
                  {s.name}
                </span>
              ))}
            </div>
          )}

          <div style={{
            display: 'flex',
            gap: '48px',
            padding: '24px 36px',
            backgroundColor: 'rgba(29,34,43,0.9)',
            border: `1px solid ${colors.BORDER}`,
          }}>
            <StatPill label="Picks" value={String(detail.pickCount)} color={colors.GREEN} />
            <StatPill label="Bans" value={String(detail.banCount)} color={colors.RED} />
            {detail.noPickCount > 0 && (
              <StatPill label="No-pick" value={String(detail.noPickCount)} />
            )}
            <StatPill label="Matches" value={String(totalMatches)} color={colors.ACCENT} />
            <StatPill label="Seasons" value={String(regularSeasons.length)} />
          </div>
        </div>
      </CardShell>
    ),
    { ...size, fonts: fontConfig(fonts) },
  );
}
