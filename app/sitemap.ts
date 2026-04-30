/**
 * sitemap.xml for coldfile.app.
 *
 * Five static URLs: marketing index + four legal pages. The
 * /feature-graphic page is intentionally excluded (it's a Play Store
 * asset, not a destination — disallowed in robots.ts as well).
 *
 * lastModified is hardcoded to the current build's deploy date. When
 * legal pages get a content update, bump the date here too. Search
 * engines crawl on their own cadence anyway; this is just a hint.
 */

import type { MetadataRoute } from 'next';

const SITE_URL = 'https://coldfile.app';
const LAST_UPDATED = '2026-04-29';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_URL}/`,
      lastModified: LAST_UPDATED,
      changeFrequency: 'monthly',
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/legal/privacy`,
      lastModified: LAST_UPDATED,
      changeFrequency: 'yearly',
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/legal/terms`,
      lastModified: LAST_UPDATED,
      changeFrequency: 'yearly',
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/legal/takedown`,
      lastModified: LAST_UPDATED,
      changeFrequency: 'yearly',
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/account/delete`,
      lastModified: LAST_UPDATED,
      changeFrequency: 'yearly',
      priority: 0.4,
    },
  ];
}
