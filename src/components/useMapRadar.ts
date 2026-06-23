'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { RadarCalibration } from '@/lib/replay/project';

/**
 * Load a map's radar calibration + image by slug (Phase 3). Shared by the replay
 * player and the map heatmap so the world→radar projection is set up identically in
 * both. Returns `calibration: null` (and a null image) for uncalibrated maps, where
 * callers fall back to auto-fit. The image's pixel size is read off the loaded
 * bitmap, not the DB.
 */
export function useMapRadar(slug: string | null): {
  calibration: RadarCalibration | null;
  radarImage: RefObject<HTMLImageElement | null>;
} {
  const [calibration, setCalibration] = useState<RadarCalibration | null>(null);
  const radarImage = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    fetch(`/api/maps/${slug}/calibration`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body?.calibration || !body.radarUrl) return;
        const { posX, posY, scale } = body.calibration;
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          radarImage.current = img;
          setCalibration({
            posX,
            posY,
            scale,
            imageWidth: img.naturalWidth,
            imageHeight: img.naturalHeight,
          });
        };
        img.src = body.radarUrl;
      })
      .catch(() => {
        /* uncalibrated — caller falls back to auto-fit */
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return { calibration, radarImage };
}
