/**
 * robots.txt for coldfile.app.
 *
 * Allows indexing of the marketing index and legal pages. Disallows the
 * Play Store feature-graphic asset — that page exists only to render the
 * 1024×500 graphic for screenshot capture, never as a destination.
 */

import type { MetadataRoute } from 'next';

const SITE_URL = 'https://coldfile.app';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/'],
        disallow: ['/feature-graphic'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
