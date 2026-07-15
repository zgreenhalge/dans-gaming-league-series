'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  autoFitProjector,
  calibratedProjector,
  type Projector,
  type Bounds,
} from '@/lib/replay/project';
import type { HeatmapKind } from '@/lib/replay/heatmap';
import type { MapHeatmapPoint } from '@/lib/queries';
import { useMapRadar } from './useMapRadar';

type SideFilter = 'all' | 'CT' | 'T';

/** Toggleable layers — each groups one or more raw point kinds with a colour. */
const LAYERS: { key: string; label: string; kinds: HeatmapKind[]; color: string }[] = [
  { key: 'death', label: 'Deaths', kinds: ['death'], color: '#e5484d' },
  { key: 'kill', label: 'Kills', kinds: ['kill'], color: '#5b9bd5' },
  { key: 'smoke', label: 'Smokes', kinds: ['smoke'], color: '#9aa0ab' },
  { key: 'fire', label: 'Fire', kinds: ['molotov', 'incendiary'], color: '#e5642d' },
  { key: 'he', label: 'HE', kinds: ['he'], color: '#d8d24b' },
  { key: 'flash', label: 'Flashes', kinds: ['flashbang'], color: '#e8e6c8' },
];

const GRENADE_KINDS = new Set<HeatmapKind>(['smoke', 'molotov', 'incendiary', 'he', 'flashbang']);

/** Approximate effect radius in world units, so grenades plot as their area. */
const GRENADE_RADIUS: Partial<Record<HeatmapKind, number>> = {
  smoke: 144,
  molotov: 150,
  incendiary: 150,
  he: 115,
  flashbang: 120,
};

const MAX_SIDE = 560;

function boundsOf(points: MapHeatmapPoint[]): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

export default function MapHeatmap({
  slug,
  matchIds,
  visibleMatchIds,
}: {
  slug: string;
  /** Every match id for this map — points are fetched lazily for these when the tab opens. */
  matchIds: number[];
  /** Match ids passing the page's season filter — points outside are hidden. */
  visibleMatchIds: Set<number>;
}) {
  const { calibration, radarImage } = useMapRadar(slug);
  // null = still loading the per-match artifacts (fetched only when this tab mounts, so
  // the map page no longer pays the per-match R2 fan-out on every render).
  const [points, setPoints] = useState<MapHeatmapPoint[] | null>(null);
  // Players present in the fetched points, for the per-player filter dropdown.
  const [players, setPlayers] = useState<{ id: number; name: string }[]>([]);
  const [active, setActive] = useState<Set<string>>(new Set(['death']));
  const [side, setSide] = useState<SideFilter>('all');
  const [playerId, setPlayerId] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/maps/${slug}/heatmap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ matchIds }),
    })
      .then((res) => (res.ok ? res.json() : { points: [], players: [] }))
      .then((body) => {
        if (cancelled) return;
        setPoints(body.points ?? []);
        setPlayers(body.players ?? []);
        setPlayerId(null);
      })
      .catch(() => {
        if (cancelled) return;
        setPoints([]);
        setPlayers([]);
        setPlayerId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, matchIds]);

  // Auto-fit bounds use ALL points (stable view across filter changes); calibration
  // ignores them entirely.
  const allBounds = useMemo(() => boundsOf(points ?? []), [points]);

  const activeKinds = useMemo(() => {
    const set = new Set<HeatmapKind>();
    for (const l of LAYERS) if (active.has(l.key)) for (const k of l.kinds) set.add(k);
    return set;
  }, [active]);

  const colorOfKind = useMemo(() => {
    const m = new Map<HeatmapKind, string>();
    for (const l of LAYERS) for (const k of l.kinds) m.set(k, l.color);
    return m;
  }, []);

  const visible = useMemo(
    () =>
      (points ?? []).filter(
        (p) =>
          visibleMatchIds.has(p.matchId) &&
          activeKinds.has(p.kind) &&
          (side === 'all' || p.side === side) &&
          (playerId === null || p.playerId === playerId),
      ),
    [points, visibleMatchIds, activeKinds, side, playerId],
  );

  // Only offer players who actually have a point within the current season filter —
  // `players` (from the API) covers every match in `matchIds`, which is broader than
  // `visibleMatchIds` once the season filter narrows it.
  const availablePlayers = useMemo(() => {
    const ids = new Set<number>();
    for (const p of points ?? []) {
      if (visibleMatchIds.has(p.matchId) && p.playerId !== null) ids.add(p.playerId);
    }
    const nameById = new Map(players.map((p) => [p.id, p.name]));
    return [...ids]
      .map((id) => ({ id, name: nameById.get(id) ?? `#${id}` }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [points, visibleMatchIds, players]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const render = () => {
      const maxByHeight = Math.round((window.innerHeight || 800) * 0.6);
      const sidePx = Math.max(240, Math.min(container.clientWidth, MAX_SIDE, maxByHeight));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(sidePx * dpr);
      canvas.height = Math.round(sidePx * dpr);
      canvas.style.width = `${sidePx}px`;
      canvas.style.height = `${sidePx}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      let projector: Projector | null = null;
      if (calibration) projector = calibratedProjector(calibration, sidePx, sidePx);
      else if (allBounds) projector = autoFitProjector(allBounds, sidePx, sidePx);

      // Background
      ctx.fillStyle = '#0b0e14';
      ctx.fillRect(0, 0, sidePx, sidePx);
      if (calibration && radarImage.current) {
        const tl = projector!.project({ x: calibration.posX, y: calibration.posY });
        const br = projector!.project({
          x: calibration.posX + calibration.imageWidth * calibration.scale,
          y: calibration.posY - calibration.imageHeight * calibration.scale,
        });
        ctx.globalAlpha = 0.85;
        ctx.drawImage(radarImage.current, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        ctx.globalAlpha = 1;
      }
      if (!projector) return;

      // Points render in two passes so "one point is still clearly visible" and
      // "many overlapping points don't blow out to white" are controlled
      // independently instead of fighting over one alpha value.
      //
      // Pass 1 — a soft, wide halo (the density *field*): 'screen' rather than
      // 'lighter', since 'lighter' sums RGB with no ceiling until it clips at 255,
      // blowing a busy chokepoint out to solid white within a handful of overlapping
      // points. 'screen' (1 - (1-a)(1-b)) approaches white only asymptotically, so it
      // takes far more stacked points before an area reads as a flat glare instead of
      // a color gradient. Its alpha is intentionally low — this pass's job is the
      // gradient across a cluster, not making a lone point pop.
      ctx.globalCompositeOperation = 'screen';
      for (const p of visible) {
        const c = projector.project(p);
        const color = colorOfKind.get(p.kind) ?? '#ffffff';
        if (GRENADE_KINDS.has(p.kind)) {
          // Plot grenades as their effect area.
          const r = Math.max(4, projector.scaleLength(GRENADE_RADIUS[p.kind] ?? 100));
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.14;
          ctx.beginPath();
          ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Alpha is baked into the gradient, so reset globalAlpha — otherwise a
          // grenade drawn earlier in the loop leaks onto these and dims them.
          ctx.globalAlpha = 1;
          const r = 16;
          const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
          g.addColorStop(0, hexAlpha(color, 0.18));
          g.addColorStop(1, hexAlpha(color, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Pass 2 — a small, brighter core pinpointing each kill/death exactly, so a
      // single point (or a handful spread across a chokepoint, not stacked pixel for
      // pixel) still reads clearly on top of pass 1's low-alpha field. Grenades don't
      // get one — they're already an area marker, not a pinpoint event. This layer
      // *can* still wash toward white, but only within its own tiny radius where many
      // kills genuinely landed at virtually the same spot (e.g. a common angle) —
      // a real signal worth showing brightly, not the map-wide blowout this replaces.
      ctx.globalCompositeOperation = 'lighter';
      for (const p of visible) {
        if (GRENADE_KINDS.has(p.kind)) continue;
        const c = projector.project(p);
        const color = colorOfKind.get(p.kind) ?? '#ffffff';
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(container);
    return () => ro.disconnect();
  }, [visible, calibration, allBounds, colorOfKind, radarImage]);

  const toggle = (key: string) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (points === null) {
    return (
      <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">Loading heatmap…</div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
        No heatmap data yet — generate replays for this map&apos;s matches to populate it.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Layer + side controls */}
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        {LAYERS.map((l) => (
          <button
            key={l.key}
            type="button"
            onClick={() => toggle(l.key)}
            className={`flex items-center gap-1.5 border px-2 py-0.5 font-mono ${
              active.has(l.key)
                ? 'border-[var(--color-text-primary)] text-[var(--color-text-primary)]'
                : 'border-[var(--color-border-primary)] text-[var(--color-text-secondary)]'
            }`}
          >
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} />
            {l.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {availablePlayers.length > 0 && (
            <select
              value={playerId ?? ''}
              onChange={(e) => setPlayerId(e.target.value === '' ? null : Number(e.target.value))}
              className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-1.5 py-0.5 font-mono text-[var(--color-text-primary)]"
            >
              <option value="">All players</option>
              {availablePlayers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-1">
            {(['all', 'CT', 'T'] as SideFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className={`border px-1.5 py-0.5 font-mono ${
                  side === s
                    ? 'border-[var(--color-text-primary)] text-[var(--color-text-primary)]'
                    : 'border-[var(--color-border-primary)] text-[var(--color-text-secondary)]'
                }`}
              >
                {s === 'all' ? 'Both' : s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div ref={containerRef} className="w-full">
        <canvas ref={canvasRef} className="block mx-auto border border-[var(--color-border-primary)]" />
      </div>
      <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">
        {visible.length} point{visible.length === 1 ? '' : 's'}
        {!calibration && ' · auto-fit (map not calibrated)'}
      </div>
    </div>
  );
}

/** `#rrggbb` + alpha → `rgba(...)`. */
function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
