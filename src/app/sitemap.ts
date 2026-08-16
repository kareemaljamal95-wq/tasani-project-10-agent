import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

/**
 * Only publicly reachable pages belong here. Dashboard routes redirect to
 * /login for anonymous visitors, so listing them would fill the index with
 * redirects.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    { url: SITE.url, lastModified, changeFrequency: 'weekly', priority: 1 },
    {
      url: `${SITE.url}/login`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${SITE.url}/register`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.5,
    },
  ];
}
