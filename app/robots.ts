/**
 * robots.txt for coldfile.app.
 *
 * Two-tier policy:
 *
 *   • Indexing crawlers (Googlebot, Bingbot, the long tail) — allow the
 *     full marketing surface, the legal pages, and the per-case landing
 *     pages. Disallow only the Play Store feature-graphic asset (a 1024
 *     × 500 image renderer, never a destination).
 *
 *   • LLM training crawlers — disallow entirely. Cold-case data is
 *     family-sensitive; the source datasets (NamUs, Charley, Doe,
 *     agency releases) were not consented for model training. This is
 *     the dignity-posture call (feedback_amber_is_ethical_posture +
 *     feedback_community_features_guardrail), not a generic policy.
 *
 * Note on Google-Extended: this user-agent governs Gemini training only
 * and is independent from Googlebot's regular crawl. Disallowing it
 * does NOT hide the site from Google Search — it tells Google not to
 * use the content as training data.
 */

import type { MetadataRoute } from 'next';

const SITE_URL = 'https://coldfile.app';

const AI_TRAINING_BOTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'CCBot',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'Google-Extended',
  'PerplexityBot',
  'Bytespider',
  'Amazonbot',
  'Applebot-Extended',
  'cohere-ai',
  'Meta-ExternalAgent',
  'Diffbot',
  'FacebookBot',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/'],
        disallow: ['/feature-graphic'],
      },
      {
        userAgent: AI_TRAINING_BOTS,
        disallow: '/',
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
