/**
 * Content hash for tip_routings.content_hash.
 *
 * The user's tip text never leaves the device; only the SHA-256 hex digest
 * does. The salt is a project-wide constant — not a security boundary, just
 * pepper that prevents commodity rainbow-table lookups against known phrases.
 *
 * If we ever need to rotate, bump the salt to V2 and write a one-shot migration
 * to recompute existing rows from a back-channel — the hash never reverses to
 * content, so rotation is destructive without re-collection.
 *
 * See docs/04_DESIGN_SYSTEM.md "Content hash".
 */

import * as Crypto from 'expo-crypto';

const SALT = 'COLD_FILE_TIP_HASH_SALT_V1';

/**
 * Returns the lowercase-hex SHA-256 of `${SALT}${content}`. Empty / whitespace-only
 * content returns null — don't store a degenerate hash for an empty body.
 */
export async function hashTipContent(content: string): Promise<string | null> {
  const trimmed = content.trim();
  if (!trimmed) return null;
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${SALT}${trimmed}`,
  );
}
