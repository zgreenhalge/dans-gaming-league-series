import type { ReactNode } from 'react';

// The pieces a match page's header is built from, shared by the league match page and the scrim match
// page: the map-art backdrop behind the header, and the centered slot each header panel (server,
// demo review) sits in.

/** The header's map backdrop. The gradient shows whether or not the map has an image. */
export function MatchMapBackdrop({ map, mapImg, children }: { map: string | null; mapImg: string | undefined; children: ReactNode }) {
  return (
    <div
      className={`-mx-6 px-6 ${map ? 'map-card-bg light-boost' : 'map-no-img'}`}
      style={map ? ({ ['--map-img' as string]: mapImg ? `url("${mapImg}")` : 'none' } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}

/** A header panel, centered at a readable width. */
export function MatchPanelSlot({ children }: { children: ReactNode }) {
  return (
    <div className="pb-6 flex justify-center">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
