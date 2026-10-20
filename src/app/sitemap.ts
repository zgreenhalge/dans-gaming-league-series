import type { MetadataRoute } from 'next';
import { SITE_URL, matchUrl } from '@/lib/seo/site';
import { getSeasons, getPlayersById, getMapLookup, getAllPlayedMatchIds, getStagePagePaths } from '@/lib/queries';
import { TOOLS, toolHref } from '@/lib/tools';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [seasons, playersById, mapLookup, matchIds, stagePaths] = await Promise.all([
    getSeasons(),
    getPlayersById(),
    getMapLookup(),
    getAllPlayedMatchIds(),
    getStagePagePaths(),
  ]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/statistics`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/seasons`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/maps`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/tools`, changeFrequency: 'monthly', priority: 0.4 },
    ...TOOLS.map((t) => ({ url: `${SITE_URL}${toolHref(t.slug)}`, changeFrequency: 'monthly' as const, priority: 0.4 })),
  ];

  const seasonRoutes: MetadataRoute.Sitemap = seasons.map((s) => ({
    url: `${SITE_URL}/seasons/${s.id}`,
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  const stageRoutes: MetadataRoute.Sitemap = stagePaths.map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: 'weekly',
    priority: 0.5,
  }));

  const matchRoutes: MetadataRoute.Sitemap = matchIds.map((id) => ({
    url: matchUrl(id),
    changeFrequency: 'monthly',
    priority: 0.5,
  }));

  const playerRoutes: MetadataRoute.Sitemap = Array.from(playersById.keys()).map((id) => ({
    url: `${SITE_URL}/players/${id}`,
    changeFrequency: 'weekly',
    priority: 0.6,
  }));

  const mapRoutes: MetadataRoute.Sitemap = Object.keys(mapLookup).map((slug) => ({
    url: `${SITE_URL}/maps/${slug}`,
    changeFrequency: 'weekly',
    priority: 0.5,
  }));

  return [...staticRoutes, ...seasonRoutes, ...stageRoutes, ...matchRoutes, ...playerRoutes, ...mapRoutes];
}
