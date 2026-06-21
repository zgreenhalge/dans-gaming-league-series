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
    { key: 'WR%', width: '100px' },
    { key: 'RWR%', width: '100px' },
    { key: 'ADR', width: '100px' },
    { key: 'K/D', width: '90px' },
  ];

  return new ImageResponse(
    (
      <CardShell subtitle={isLive ? 'Live' : isUpcoming ? 'Upcoming' : undefined}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '8px' }}>
          <span style={{ fontSize: '48px', fontWeight: 600 }}>{title}</span>
          {isLive && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 12px',
              backgroundColor: 'rgba(91,150,54,0.2)',
              border: `1px solid ${colors.GREEN}`,
              fontSize: '14px',
              fontFamily: 'JetBrains Mono',
              color: colors.GREEN,
              letterSpacing: '1px',
            }}>
              LIVE
            </div>
          )}
        </div>

        {top4.length > 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            marginTop: '32px',
            border: `1px solid ${colors.BORDER}`,
            backgroundColor: colors.BG2,
          }}>
            {/* Header */}
            <div style={{
              display: 'flex',
              padding: '12px 20px',
              borderBottom: `1px solid ${colors.BORDER}`,
              fontFamily: 'JetBrains Mono',
              fontSize: '13px',
              color: colors.TEXT2,
              letterSpacing: '1px',
              textTransform: 'uppercase',
            }}>
              <span style={{ width: '40px' }}>#</span>
              <span style={{ flex: 1 }}>Player</span>
              {cols.map(c => (
                <span key={c.key} style={{ width: c.width, textAlign: 'right' }}>{c.key}</span>
              ))}
            </div>

            {/* Rows */}
            {top4.map((p, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  padding: '14px 20px',
                  borderBottom: i < top4.length - 1 ? `1px solid ${colors.BORDER}` : 'none',
                  fontSize: '22px',
                  alignItems: 'center',
                }}
              >
                <span style={{
                  width: '40px',
                  fontFamily: 'JetBrains Mono',
                  fontSize: '18px',
                  color: i === 0 ? colors.AMBER : colors.TEXT2,
                  fontWeight: 600,
                }}>
                  {i + 1}
                </span>
                <span style={{ flex: 1, fontWeight: 600, fontSize: '24px' }}>
                  {p.player_name}
                </span>
                <span style={{ width: '100px', textAlign: 'right', fontFamily: 'JetBrains Mono', fontSize: '20px', color: colors.GREEN }}>
                  {p.win_rate_percentage.toFixed(0)}%
                </span>
                <span style={{ width: '100px', textAlign: 'right', fontFamily: 'JetBrains Mono', fontSize: '20px' }}>
                  {p.rwr_percentage.toFixed(0)}%
                </span>
                <span style={{ width: '100px', textAlign: 'right', fontFamily: 'JetBrains Mono', fontSize: '20px' }}>
                  {p.overall_adr.toFixed(1)}
                </span>
                <span style={{ width: '90px', textAlign: 'right', fontFamily: 'JetBrains Mono', fontSize: '20px' }}>
                  {p.kd_ratio.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: '32px', fontSize: '24px', color: colors.TEXT2 }}>
            No matches played yet.
          </div>
        )}
      </CardShell>
    ),
    { ...size, fonts: fontConfig(fonts) },
  );
}
