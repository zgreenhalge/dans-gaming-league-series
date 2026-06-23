import { ImageResponse } from 'next/og';
import { getSeason } from '@/lib/queries';
import { getSeasonMetaLeaderboard } from '@/lib/og';
import { seasonTitle } from '@/lib/util';
import { OG_SIZE, colors, loadFonts, fontConfig, CardShell } from '@/lib/og-card';

export const alt = 'DGLS Season';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const revalidate = 60;

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const seasonId = Number(id);
  const [season, top4, fonts] = await Promise.all([
    getSeason(seasonId),
    getSeasonMetaLeaderboard(seasonId),
    loadFonts(),
  ]);

  if (!season) {
    return new ImageResponse(
      <CardShell><div style={{ fontSize: '48px', fontWeight: 600 }}>Season not found</div></CardShell>,
      { ...size, fonts: fontConfig(fonts) },
    );
  }

  const title = seasonTitle(season.name);
  const isLive = season.status === 'ACTIVE';
  const isUpcoming = season.status === 'UPCOMING';

  const cols = [
    { key: 'WR%', width: '120px' },
    { key: 'RWR%', width: '120px' },
    { key: 'ADR', width: '120px' },
    { key: 'K/D', width: '110px' },
  ];

  return new ImageResponse(
    (
      <CardShell subtitle={isLive ? 'Live' : isUpcoming ? 'Upcoming' : undefined}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginTop: '4px' }}>
          <span style={{ fontSize: '72px', fontWeight: 600 }}>{title}</span>
          {isLive && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              padding: '8px 20px',
              backgroundColor: 'rgba(91,150,54,0.2)',
              border: `1px solid ${colors.GREEN}`,
              fontSize: '28px',
              fontFamily: 'JetBrains Mono',
              color: colors.GREEN,
              letterSpacing: '2px',
            }}>
              LIVE
            </div>
          )}
        </div>

        {top4.length > 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            marginTop: '16px',
            border: `1px solid ${colors.BORDER}`,
            backgroundColor: colors.BG2,
            flex: 1,
          }}>
            <div style={{
              display: 'flex',
              padding: '14px 28px',
              borderBottom: `1px solid ${colors.BORDER}`,
              fontFamily: 'JetBrains Mono',
              fontSize: '24px',
              color: colors.TEXT2,
              letterSpacing: '1px',
              textTransform: 'uppercase',
            }}>
              <span style={{ width: '52px' }}>#</span>
              <span style={{ flex: 1 }}>Player</span>
              {cols.map(c => (
                <span key={c.key} style={{ width: c.width, textAlign: 'right' }}>{c.key}</span>
              ))}
            </div>

            {top4.map((p, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  padding: '14px 28px',
                  borderBottom: i < top4.length - 1 ? `1px solid ${colors.BORDER}` : 'none',
                  alignItems: 'center',
                }}
              >
                <span style={{
                  width: '52px',
                  fontFamily: 'JetBrains Mono',
                  fontSize: '32px',
                  color: i === 0 ? colors.AMBER : colors.TEXT2,
                  fontWeight: 600,
                }}>
                  {i + 1}
                </span>
                <span style={{ flex: 1, fontWeight: 600, fontSize: '36px' }}>
                  {p.player_name}
                </span>
                <span style={{ width: '120px', textAlign: 'right', fontFamily: 'JetBrains Mono', fontSize: '32px', color: colors.GREEN }}>
                  {p.win_rate_percentage.toFixed(0)}%
                </span>
                <span style={{ width: '120px', textAlign: 'right', fontFamily: 'JetBrains Mono', fontSize: '32px' }}>
                  {p.rwr_percentage.toFixed(0)}%
                </span>
                <span style={{ width: '120px', textAlign: 'right', fontFamily: 'JetBrains Mono', fontSize: '32px' }}>
                  {p.overall_adr.toFixed(2)}
                </span>
                <span style={{ width: '110px', textAlign: 'right', fontFamily: 'JetBrains Mono', fontSize: '32px' }}>
                  {p.kd_ratio.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: '32px', fontSize: '36px', color: colors.TEXT2 }}>
            No matches played yet.
          </div>
        )}
      </CardShell>
    ),
    { ...size, fonts: fontConfig(fonts) },
  );
}
