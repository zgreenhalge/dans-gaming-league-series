import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { TopbarShell } from '@/components/TopbarShell';
import { getMapDetail, getH2HData } from '@/lib/queries';
import { mapImageFor, toSentenceCase } from '@/lib/maps';
import { getMapLookup } from '@/lib/queries';
import { extractSeasonNumber } from '@/lib/util';
import MapDetailView from '@/components/MapDetailView';

export const revalidate = 60;

type Season = { id: number; name: string; is_gauntlet: boolean };

function SeasonPoolChips({ seasons, onImg }: { seasons: Season[]; onImg: boolean }) {
  if (seasons.length === 0) return null;
  const grouped = new Map<number, Season[]>();
  for (const s of seasons) {
    const num = extractSeasonNumber(s.name) ?? -1;
    const group = grouped.get(num) ?? [];
    group.push(s);
    grouped.set(num, group);
  }
  const rows = Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .map(([, group]) => group.sort((a, b) => (a.is_gauntlet ? 1 : 0) - (b.is_gauntlet ? 1 : 0)));

  const chipCls = onImg
    ? 'border-white/30 text-white/80 hover:border-white/60 hover:text-white'
    : 'border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-primary)]';

  return (
    <div className="flex flex-col gap-1.5 mt-3">
      <span className={`font-mono text-[10px] uppercase tracking-widest ${onImg ? 'text-white/50' : 'text-[var(--color-text-secondary)]'}`}>
        Pool
      </span>
      {rows.map((group) => (
        <div key={group[0].id} className="flex items-center gap-2">
          {group.map((s) => (
            <Link key={s.id} href={`/seasons/${s.id}`} className={`font-mono text-[11px] px-2 py-0.5 border transition-colors ${chipCls}`}>
              {s.name}
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getMapDetail(slug);
  if (!detail) return { title: 'Map' };

  const name = toSentenceCase(detail.name);
  const parts: string[] = [];
  if (detail.pickCount > 0) parts.push(`${detail.pickCount} picks`);
  if (detail.banCount > 0) parts.push(`${detail.banCount} bans`);
  const seasonCount = detail.seasons.filter(s => !s.is_gauntlet).length;
  if (seasonCount > 0) parts.push(`${seasonCount} season${seasonCount > 1 ? 's' : ''}`);
  const description = parts.length > 0
    ? `${name} — ${parts.join(', ')} in DGLS.`
    : `${name} map stats in DGLS.`;
  return {
    title: name,
    description,
    openGraph: {
      title: `DGLS · ${name}`,
      description,
    },
    twitter: {
      card: 'summary_large_image',
      title: `DGLS · ${name}`,
      description,
    },
  };
}

export default async function MapPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [detail, h2hData, mapLookup] = await Promise.all([
    getMapDetail(slug),
    getH2HData({ filter: 'career', includeRegular: true, includeGauntlet: true, map: slug }),
    getMapLookup(),
  ]);
  if (!detail) notFound();

  const img = mapImageFor(detail.name, mapLookup);
  const workshopUrl = mapLookup[slug]?.workshop_url ?? null;

  return (
    <div className="min-h-screen">
      <TopbarShell
        crumbs={[
          { label: 'DGLS', href: '/' },
          { label: 'Maps', href: '/maps' },
          { label: toSentenceCase(detail.name) },
        ]}
      />

      {/* Hero */}
      <div className="relative overflow-hidden h-[200px] border-b border-[var(--color-border-primary)]">
        {img && (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center scale-105"
              style={{ backgroundImage: `url("${img}")` }}
            />
            <div className="absolute inset-0 bg-black/55" />
          </>
        )}
        <div className={`relative z-10 max-w-[1080px] mx-auto px-6 h-full flex flex-col justify-end pb-6 ${img ? '' : 'bg-[var(--color-bg-secondary)]'}`}>
          <div className={`font-display text-[42px] font-semibold leading-tight ${img ? 'text-white drop-shadow' : 'text-[var(--color-text-primary)]'}`}>
            {toSentenceCase(detail.name)}
          </div>
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            {detail.pickCount > 0 && (
              <span className={`font-mono text-[12px] ${img ? 'text-white/80' : 'text-[var(--color-text-secondary)]'}`}>
                {detail.pickCount} picks
              </span>
            )}
            {detail.banCount > 0 && (
              <span className={`font-mono text-[12px] ${img ? 'text-white/80' : 'text-[var(--color-text-secondary)]'}`}>
                {detail.banCount} bans
              </span>
            )}
            {detail.noPickCount > 0 && (
              <span className={`font-mono text-[12px] ${img ? 'text-white/80' : 'text-[var(--color-text-secondary)]'}`}>
                {detail.noPickCount} no-pick
              </span>
            )}
          </div>
          {workshopUrl && (
            <a
              href={workshopUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1.5 font-mono text-[11px] mt-2 transition-colors ${img ? 'text-white/60 hover:text-white/90' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
            >
              <span>Steam Workshop</span>
              <span className="text-[9px]">↗</span>
            </a>
          )}
          <SeasonPoolChips seasons={detail.seasons} onImg={!!img} />
        </div>
      </div>

      <main className="max-w-[1080px] mx-auto px-6 pb-16 mt-8">
        <MapDetailView detail={detail} h2hData={h2hData} />
      </main>
    </div>
  );
}
