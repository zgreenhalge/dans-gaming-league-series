import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';
import { getSeasons, getPlayersById, getMapLookup, getAllPlayedMatchIds } from '@/lib/queries';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [seasons, playersById, mapLookup, matchIds] = await Promise.all([
    getSeasons(),
    getPlayersById(),
    getMapLookup(),
    getAllPlayedMatchIds(),
  ]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/statistics`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/seasons`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/maps`, changeFrequency: 'weekly', priority: 0.6 },
  ];

  const seasonRoutes: MetadataRoute.Sitemap = seasons.map((s) => ({
    url: `${SITE_URL}/seasons/${s.id}`,
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  const matchRoutes: MetadataRoute.Sitemap = matchIds.map((id) => ({
    url: `${SITE_URL}/matches/${id}`,
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

  return [...staticRoutes, ...seasonRoutes, ...matchRoutes, ...playerRoutes, ...mapRoutes];
}
