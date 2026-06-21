import { ImageResponse } from 'next/og';
import { getMatchMeta } from '@/lib/og';
import { OG_SIZE, colors, loadFonts, fontConfig, CardShell } from '@/lib/og-card';

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

  return new ImageResponse(
    (
      <CardShell subtitle={meta.title}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          gap: '24px',
        }}>
          {/* Teams */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: '14px', color: colors.TEXT2, letterSpacing: '2px', textTransform: 'uppercase' }}>
                Shirts
              </span>
              <span style={{ fontSize: '32px', fontWeight: 600 }}>
                {meta.shirtNames || '—'}
              </span>
            </div>

            {meta.score ? (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px' }}>
                <span style={{
                  fontFamily: 'JetBrains Mono',
                  fontSize: '72px',
                  fontWeight: 600,
                  color: meta.score.shirts > meta.score.skins ? colors.GREEN : colors.TEXT,
                }}>
                  {meta.score.shirts}
                </span>
                <span style={{ fontSize: '36px', color: colors.TEXT2 }}>—</span>
                <span style={{
                  fontFamily: 'JetBrains Mono',
                  fontSize: '72px',
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
                padding: '8px 24px',
              }}>
                <span style={{ fontSize: '36px', color: colors.TEXT2, fontFamily: 'JetBrains Mono' }}>vs</span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: '14px', color: colors.TEXT2, letterSpacing: '2px', textTransform: 'uppercase' }}>
                Skins
              </span>
              <span style={{ fontSize: '32px', fontWeight: 600 }}>
                {meta.skinNames || '—'}
              </span>
            </div>
          </div>

          {/* Map + schedule info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {meta.mapName && (
              <span style={{
                fontFamily: 'JetBrains Mono',
                fontSize: '20px',
                color: colors.ACCENT,
                padding: '4px 16px',
                border: `1px solid ${colors.ACCENT}`,
              }}>
                {meta.mapName}
              </span>
            )}
            {meta.scheduledAt && !meta.score && (
              <span style={{
                fontFamily: 'JetBrains Mono',
                fontSize: '18px',
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
