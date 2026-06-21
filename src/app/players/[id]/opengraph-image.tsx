import { ImageResponse } from 'next/og';
import { getPlayerMeta } from '@/lib/og';
import { OG_SIZE, colors, loadFonts, fontConfig, CardShell, StatPill } from '@/lib/og-card';

export const alt = 'DGLS Player';
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
    getPlayerMeta(Number(id)),
    loadFonts(),
  ]);

  if (!meta) {
    return new ImageResponse(
      <CardShell><div style={{ fontSize: '48px', fontWeight: 600 }}>Player not found</div></CardShell>,
      { ...size, fonts: fontConfig(fonts) },
    );
  }

  return new ImageResponse(
    (
      <CardShell subtitle="Player">
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', gap: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
            {meta.image && (
              <img
                src={meta.image}
                width={140}
                height={140}
                style={{ borderRadius: '10px', border: `2px solid ${colors.BORDER}` }}
              />
            )}
            <span style={{ fontSize: '84px', fontWeight: 600 }}>{meta.name}</span>
          </div>

          <div style={{
            display: 'flex',
            gap: '48px',
            padding: '28px 40px',
            backgroundColor: colors.BG2,
            border: `1px solid ${colors.BORDER}`,
          }}>
            {meta.stats.wr != null && (
              <StatPill label="Win Rate" value={`${meta.stats.wr}%`} color={colors.GREEN} />
            )}
            {meta.stats.record && (
              <StatPill label="Record" value={meta.stats.record} />
            )}
            {meta.stats.kd != null && (
              <StatPill label="K/D" value={meta.stats.kd} />
            )}
            {meta.stats.adr != null && (
              <StatPill label="ADR" value={meta.stats.adr} />
            )}
            {meta.stats.ehog != null && (
              <StatPill label="EHOG" value={meta.stats.ehog} color={colors.ACCENT} />
            )}
          </div>
        </div>
      </CardShell>
    ),
    { ...size, fonts: fontConfig(fonts) },
  );
}
