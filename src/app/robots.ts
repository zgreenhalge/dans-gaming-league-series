import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// Permissive by design, including for AI crawlers (ClaudeBot, GPTBot, PerplexityBot,
// Google-Extended) — only API routes and authenticated admin/auth surfaces are off-limits.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/admin/', '/auth/'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
