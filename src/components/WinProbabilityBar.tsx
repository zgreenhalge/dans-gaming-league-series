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

function WinProbabilityTooltip({ provisional }: { provisional: boolean }) {
  return (
    <span tabIndex={0} className="group relative inline-flex items-center cursor-help ml-1.5">
      <span className="border border-[var(--color-border-secondary)] rounded-full w-3.5 h-3.5 inline-flex items-center justify-center leading-none font-mono text-[9px] text-[var(--color-text-secondary)]">
        ?
      </span>
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1.5 w-64 rounded border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] p-2 font-mono text-[10px] leading-snug normal-case text-[var(--color-text-secondary)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus:opacity-100 z-10">
        EHOG win probability comes from each team&apos;s current rating alone. A narrow gap in a
        small, wide-skill league can still land near 50%, and a wide gap can land at 80–90% — both
        are expected, not a bug.
        {provisional && (
          <>
            {' '}One or more players here are still early in their rating history, so this
            prediction carries extra uncertainty beyond the number shown.
          </>
        )}
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
  const shirtsColor = factionColor(shirtsF);
  const skinsColor = factionColor(skinsF);

  return (
    <div className="mt-5 max-w-md mx-auto">
      <div className="flex items-center justify-between mb-1.5 font-mono text-[13px] font-bold tracked">
        <span style={{ color: shirtsColor }}>
          SHIRTS {shirtsPct}%{played && shirtsWon ? ' ✓' : ''}
        </span>
        {!played && <WinProbabilityTooltip provisional={provisional} />}
        <span style={{ color: skinsColor }}>
          {skinsPct}% SKINS{played && !shirtsWon ? ' ✓' : ''}
        </span>
      </div>
      <div className="h-3 w-full rounded-full overflow-hidden flex border border-[var(--color-border-primary)]">
        <div style={{ width: `${shirtsPct}%`, background: shirtsColor }} />
        <div style={{ width: `${skinsPct}%`, background: skinsColor }} />
      </div>
    </div>
  );
}
