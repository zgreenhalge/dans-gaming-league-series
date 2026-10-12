import { ImageResponse } from 'next/og';
import { parseScore } from '../util';
import { OG_SIZE, colors, loadFonts, fontConfig, CardShell } from './og-card';

// The Open Graph card for a week, round or group page: a title, then the stage's matchups with their
// scores, optionally beside the top of its scorecard. Shared so the three pages preview alike.

export interface StageOgMatchup {
  shirts: string;
  skins: string;
  finalScore: string | null;
}

export interface StageOgStanding {
  name: string;
  record: string;
}

export interface StageOgData {
  title: string;
  /** "Live" / "Complete" / "Upcoming". */
  status: string;
  matchups: StageOgMatchup[];
  standings: StageOgStanding[];
}

const MAX_MATCHUPS = 6;

function Matchup({ m }: { m: StageOgMatchup }) {
  const score = parseScore(m.finalScore);
  const played = score != null && score.shirts + score.skins > 0;
  const shirtsWon = played && score.shirts > score.skins;
  const skinsWon = played && score.skins > score.shirts;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '18px', fontSize: '30px' }}>
      <span style={{ display: 'flex', flex: 1, justifyContent: 'flex-end', fontWeight: shirtsWon ? 600 : 400, color: shirtsWon ? colors.TEXT : colors.TEXT2 }}>
        {m.shirts}
      </span>
      <span style={{ display: 'flex', width: '150px', justifyContent: 'center', fontFamily: 'JetBrains Mono', color: played ? colors.GREEN : colors.TEXT2 }}>
        {played ? `${score.shirts} – ${score.skins}` : 'vs'}
      </span>
      <span style={{ display: 'flex', flex: 1, fontWeight: skinsWon ? 600 : 400, color: skinsWon ? colors.TEXT : colors.TEXT2 }}>
        {m.skins}
      </span>
    </div>
  );
}

export async function renderStageOg(data: StageOgData | null, notFoundText: string): Promise<ImageResponse> {
  const fonts = await loadFonts();
  if (!data) {
    return new ImageResponse(
      <CardShell><div style={{ fontSize: '48px', fontWeight: 600 }}>{notFoundText}</div></CardShell>,
      { ...OG_SIZE, fonts: fontConfig(fonts) },
    );
  }
  const shown = data.matchups.slice(0, MAX_MATCHUPS);
  const hidden = data.matchups.length - shown.length;
  return new ImageResponse(
    (
      <CardShell subtitle={data.status}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '22px', marginTop: '8px' }}>
          <span style={{ fontSize: '64px', fontWeight: 600 }}>{data.title}</span>
          <div style={{ display: 'flex', flex: 1, gap: '40px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '16px', justifyContent: 'center' }}>
              {shown.length > 0 ? shown.map((m, i) => <Matchup key={i} m={m} />) : (
                <span style={{ fontSize: '32px', color: colors.TEXT2, fontFamily: 'JetBrains Mono' }}>Matchups to be announced</span>
              )}
              {hidden > 0 && <span style={{ fontSize: '24px', color: colors.TEXT2, fontFamily: 'JetBrains Mono' }}>+{hidden} more</span>}
            </div>
            {data.standings.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', width: '300px', gap: '10px', justifyContent: 'center', borderLeft: `2px solid ${colors.BORDER}`, paddingLeft: '32px' }}>
                {data.standings.slice(0, 5).map((s, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '28px' }}>
                    <span style={{ display: 'flex', fontWeight: i === 0 ? 600 : 400 }}>{i + 1}. {s.name}</span>
                    <span style={{ display: 'flex', fontFamily: 'JetBrains Mono', color: colors.TEXT2 }}>{s.record}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardShell>
    ),
    { ...OG_SIZE, fonts: fontConfig(fonts) },
  );
}

export const STATUS_LABEL = { complete: 'Complete', 'in-progress': 'Live', upcoming: 'Upcoming' } as const;
