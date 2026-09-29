'use client';

import { createContext, useContext } from 'react';

export type MapEntry = { image_url: string | null; workshop_url: string | null };
type MapLookup = Record<string, MapEntry>;

const MapContext = createContext<MapLookup>({});

export function MapProvider({ maps, children }: { maps: MapLookup; children: React.ReactNode }) {
  return <MapContext value={maps}>{children}</MapContext>;
}

export function useMapLookup(): MapLookup {
  return useContext(MapContext);
}
