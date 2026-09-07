// Head-to-head EHOG win-probability bar for the match detail page — SHIRTS/SKINS on either end,
// the bar split at the SHIRTS-win percentage. Pre-match uses a live prediction (current ratings);
// post-match reads the frozen matches.pre_match_win_prob and marks whichever side actually won.

import { factionColor } from '@/lib/util';
import { InfoTooltip } from './InfoTooltip';

type Faction = 'CT' | 'T' | null;

export function WinProbabilityBar({
  pShirtsWin,
  shirtsF,
  skinsF,
  provisional = false,
  played,
  shirtsWon,
}: {
  pShirtsWin: number;
  shirtsF: Faction;
  skinsF: Faction;
  /** Only meaningful pre-match — the frozen post-match number carries no stored σ to check. */
  provisional?: boolean;
  played: boolean;
  shirtsWon: boolean;
}) {
  const shirtsPct = Math.round(pShirtsWin * 100);
  const skinsPct = 100 - shirtsPct;
  const shirtsBase = factionColor(shirtsF);
  const skinsBase = factionColor(skinsF);
  // Once a match is played, the winner's side fills in solid with their team color; the loser's
  // side fades toward the background (still tinted with their own color, not swapped to a flat
  // neutral) — so the bar reads as a result at a glance, not just a prediction.
  const shirtsLost = played && !shirtsWon;
  const skinsLost = played && shirtsWon;
  const shirtsFill = shirtsLost ? `color-mix(in srgb, ${shirtsBase} 25%, var(--color-bg-secondary))` : shirtsBase;
  const skinsFill = skinsLost ? `color-mix(in srgb, ${skinsBase} 25%, var(--color-bg-secondary))` : skinsBase;
  const shirtsLabelColor = shirtsLost ? 'var(--color-text-secondary)' : shirtsBase;
  const skinsLabelColor = skinsLost ? 'var(--color-text-secondary)' : skinsBase;

  return (
    <div className="mt-5 max-w-md mx-auto">
      <div className="flex items-center justify-between mb-1.5 font-mono text-[13px] font-bold tracked">
        <span style={{ color: shirtsLabelColor }}>
          SHIRTS {shirtsPct}%{played && shirtsWon ? ' ✓' : ''}
        </span>
        {!played && provisional && (
          <InfoTooltip className="ml-1.5">
            One or more players are early in their rating history, so this prediction carries extra
            uncertainty.
          </InfoTooltip>
        )}
        <span style={{ color: skinsLabelColor }}>
          {skinsPct}% SKINS{played && !shirtsWon ? ' ✓' : ''}
        </span>
      </div>
      <div className="h-3 w-full rounded-full overflow-hidden flex border border-[var(--color-border-primary)]">
        <div style={{ width: `${shirtsPct}%`, background: shirtsFill }} />
        <div style={{ width: `${skinsPct}%`, background: skinsFill }} />
      </div>
    </div>
  );
}
