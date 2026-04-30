/**
 * web app manifest for coldfile.app.
 *
 * The app/manifest.ts convention emits manifest.webmanifest at the root.
 * Useful for PWA install prompts and to satisfy the "missing manifest"
 * SEO audit finding. Icons reference app/icon.png (256) + the larger
 * mobile asset for high-DPI install banners.
 */

import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'The Cold File',
    short_name: 'Cold File',
    description:
      'Discover unsolved cases near you. Tips routed to the agencies that own them — never held by us.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    icons: [
      { src: '/icon.png', sizes: '256x256', type: 'image/png' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
