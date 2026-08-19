import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Authenticated surfaces and the API carry no public value and would
      // otherwise waste crawl budget on pages that only redirect to /login.
      disallow: [
        '/api/',
        '/dashboard',
        '/agents',
        '/approvals',
        '/brain',
        '/business',
        '/commerce',
        '/executive',
        '/growth',
        '/sales',
        '/settings',
        '/billing',
      ],
    },
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
