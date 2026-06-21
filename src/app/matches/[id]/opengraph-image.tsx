import { ImageResponse } from 'next/og';
import { getMatchMeta } from '@/lib/og';
import { mapImageFor } from '@/lib/maps';
import { OG_SIZE, colors, loadFonts, fontConfig, CardShell, loadMapImageAsDataUri } from '@/lib/og-card';

export const alt = 'DGLS Match';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const revalidate = 60;

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [meta, fonts] = await Promise.all([
    getMatchMeta(Number(id)),
    loadFonts(),
  ]);

  if (!meta) {
    return new ImageResponse(
      <CardShell><div style={{ fontSize: '48px', fontWeight: 600 }}>Match not found</div></CardShell>,
      { ...size, fonts: fontConfig(fonts) },
    );
  }

  const mapRelPath = meta.mapName ? mapImageFor(meta.mapName) : undefined;
  const bgImage = mapRelPath ? await loadMapImageAsDataUri(mapRelPath) : null;

  return new ImageResponse(
    (
      <CardShell subtitle={meta.title} bgImage={bgImage ?? undefined}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          gap: '28px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '40px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: '24px', color: colors.TEXT2, letterSpacing: '2px', textTransform: 'uppercase' }}>
                Shirts
              </span>
              <span style={{ fontSize: '46px', fontWeight: 600 }}>
                {meta.shirtNames || '—'}
              </span>
            </div>

            {meta.score ? (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '20px' }}>
                <span style={{
                  fontFamily: 'JetBrains Mono',
                  fontSize: '96px',
                  fontWeight: 600,
                  color: meta.score.shirts > meta.score.skins ? colors.GREEN : colors.TEXT,
                }}>
                  {meta.score.shirts}
                </span>
                <span style={{ fontSize: '52px', color: colors.TEXT2 }}>—</span>
                <span style={{
                  fontFamily: 'JetBrains Mono',
                  fontSize: '96px',
                  fontWeight: 600,
                  color: meta.score.skins > meta.score.shirts ? colors.GREEN : colors.TEXT,
                }}>
                  {meta.score.skins}
                </span>
              </div>
            ) : (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '8px 28px',
              }}>
                <span style={{ fontSize: '52px', color: colors.TEXT2, fontFamily: 'JetBrains Mono' }}>vs</span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: '24px', color: colors.TEXT2, letterSpacing: '2px', textTransform: 'uppercase' }}>
                Skins
              </span>
              <span style={{ fontSize: '46px', fontWeight: 600 }}>
                {meta.skinNames || '—'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            {meta.mapName && (
              <span style={{
                fontFamily: 'JetBrains Mono',
                fontSize: '30px',
                color: colors.ACCENT,
                padding: '8px 22px',
                border: `1px solid ${colors.ACCENT}`,
                backgroundColor: 'rgba(22,26,33,0.8)',
              }}>
                {meta.mapName}
              </span>
            )}
            {meta.scheduledAt && !meta.score && (
              <span style={{
                fontFamily: 'JetBrains Mono',
                fontSize: '28px',
                color: colors.TEXT2,
              }}>
                {meta.scheduledAt}
              </span>
            )}
          </div>
        </div>
      </CardShell>
    ),
    { ...size, fonts: fontConfig(fonts) },
  );
}
