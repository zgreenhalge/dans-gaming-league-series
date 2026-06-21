'use client';

import { createContext, useContext } from 'react';
import { mapSlug } from '@/lib/maps';

export type MapEntry = { image_url: string | null; workshop_url: string | null };
type MapLookup = Record<string, MapEntry>;

const MapContext = createContext<MapLookup>({});

export function MapProvider({ maps, children }: { maps: MapLookup; children: React.ReactNode }) {
  return <MapContext value={maps}>{children}</MapContext>;
}

export function useMapLookup(): MapLookup {
  return useContext(MapContext);
}

export function useMapImage(raw: string | null | undefined): string | undefined {
  const maps = useContext(MapContext);
  if (!raw) return undefined;
  return maps[mapSlug(raw)]?.image_url ?? undefined;
}

export function useMapWorkshopUrl(raw: string | null | undefined): string | undefined {
  const maps = useContext(MapContext);
  if (!raw) return undefined;
  return maps[mapSlug(raw)]?.workshop_url ?? undefined;
}
