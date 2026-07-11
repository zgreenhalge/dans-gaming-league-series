'use client';

// Head-to-head EHOG win-probability bar for the match detail page — SHIRTS/SKINS on either end,
// the bar split at the SHIRTS-win percentage. Pre-match uses a live prediction (current ratings);
// post-match reads the frozen matches.pre_match_win_prob and marks whichever side actually won.

type Faction = 'CT' | 'T' | null;

function factionColor(f: Faction): string {
  if (f === 'CT') return 'var(--color-ct)';
  if (f === 'T') return 'var(--color-t)';
  return 'var(--color-text-secondary)';
}

function WinProbabilityTooltip() {
  return (
    <span tabIndex={0} className="group relative inline-flex items-center cursor-help ml-1.5">
      <span className="border border-[var(--color-border-secondary)] rounded-full w-3.5 h-3.5 inline-flex items-center justify-center leading-none font-mono text-[9px] text-[var(--color-text-secondary)]">
        ?
      </span>
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1.5 w-56 rounded border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] p-2 font-mono text-[10px] leading-snug normal-case text-[var(--color-text-secondary)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus:opacity-100 z-10">
        One or more players are early in their rating history, so this prediction carries extra
        uncertainty.
      </span>
    </span>
  );
}

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
        {!played && provisional && <WinProbabilityTooltip />}
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
