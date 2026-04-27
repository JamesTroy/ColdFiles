// Photo + media caching helper. Turns ExtractedPhoto[] into case_media rows
// backed by Supabase Storage. Content-hash dedupes identical media even when
// multiple sources mirror the same image at different URLs.
//
// Design contract: idempotent. Re-running on the same case is a no-op once
// every photo has been cached.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtractedPhoto, MediaKind } from './types.ts';
import { PoliteFetcher, sha256Hex } from './http.ts';

const STORAGE_BUCKET = 'case-media';

interface CacheMediaCtx {
  supabase: SupabaseClient;
  caseId: string;
  sourceId: string;
  fetcher: PoliteFetcher;
}

export async function cacheMediaForCase(
  ctx: CacheMediaCtx,
  photos: ExtractedPhoto[],
): Promise<{ inserted: number; skipped: number; errors: number }> {
  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  let primarySet = await caseHasPrimary(ctx.supabase, ctx.caseId);

  for (const photo of photos) {
    try {
      const result = await cacheOne(ctx, photo, !primarySet);
      if (result === 'inserted') {
        inserted += 1;
        if (!primarySet) primarySet = true;
      } else {
        skipped += 1;
      }
    } catch (err) {
      errors += 1;
      console.warn(`[media] cache failed for ${photo.url}: ${errMessage(err)}`);
    }
  }

  return { inserted, skipped, errors };
}

async function cacheOne(
  ctx: CacheMediaCtx,
  photo: ExtractedPhoto,
  markPrimary: boolean,
): Promise<'inserted' | 'skipped'> {
  const bytes = await ctx.fetcher.getBytes(photo.url);
  const u8 = new Uint8Array(bytes);
  const contentHash = await sha256Hex(u8);

  // Dedupe by (case_id, kind, content_hash) — see migrations/01_schema.sql
  const { data: existing } = await ctx.supabase
    .from('case_media')
    .select('id')
    .eq('case_id', ctx.caseId)
    .eq('kind', photo.kind)
    .eq('content_hash', contentHash)
    .maybeSingle();
  if (existing) return 'skipped';

  const ext = guessExtension(photo.url, bytes);
  const objectPath = `${ctx.caseId}/${photo.kind}/${contentHash.slice(0, 2)}/${contentHash}.${ext}`;

  const { error: uploadErr } = await ctx.supabase.storage
    .from(STORAGE_BUCKET)
    .upload(objectPath, u8, {
      contentType: mimeFromExt(ext),
      upsert: false,
      cacheControl: '31536000',
    });

  // Treat duplicate-storage-key as a soft success: another source ingested the
  // identical image first. Drop straight to the case_media insert.
  if (uploadErr && !isAlreadyExistsError(uploadErr.message)) {
    throw uploadErr;
  }

  const publicUrl = ctx.supabase.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath).data
    .publicUrl;

  const { error: insErr } = await ctx.supabase.from('case_media').insert({
    case_id: ctx.caseId,
    source_id: ctx.sourceId,
    kind: photo.kind,
    url: publicUrl,
    source_url: photo.url,
    caption: photo.caption,
    is_primary: markPrimary && photo.kind.startsWith('photo_victim'),
    bytes: u8.byteLength,
    content_hash: contentHash,
  });
  if (insErr) throw insErr;

  return 'inserted';
}

async function caseHasPrimary(supabase: SupabaseClient, caseId: string): Promise<boolean> {
  const { count } = await supabase
    .from('case_media')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseId)
    .eq('is_primary', true);
  return (count ?? 0) > 0;
}

function guessExtension(url: string, bytes: ArrayBuffer): string {
  const fromUrl = url.match(/\.(jpe?g|png|webp|gif|pdf)(?:\?|#|$)/i);
  if (fromUrl) return fromUrl[1].toLowerCase().replace('jpeg', 'jpg');
  // Magic-byte sniff for the common formats we expect.
  const head = new Uint8Array(bytes.slice(0, 8));
  if (head[0] === 0xff && head[1] === 0xd8) return 'jpg';
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'png';
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46) return 'webp';
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf';
  return 'bin';
}

function mimeFromExt(ext: string): string {
  switch (ext) {
    case 'jpg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

function isAlreadyExistsError(msg: string): boolean {
  return /already exists|duplicate|409/i.test(msg);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Standalone backfill: scan recently-ingested cases and cache any photos still
 * referenced only by source_url (i.e. case_sources.raw_payload.photos[*])
 * but not yet in case_media. Used by the photo-cache Edge Function.
 */
export async function backfillPendingPhotos(
  supabase: SupabaseClient,
  fetcher: PoliteFetcher,
  opts: { caseLimit?: number } = {},
): Promise<{ scanned: number; inserted: number }> {
  let scanned = 0;
  let inserted = 0;

  const { data: pending } = await supabase
    .from('case_sources')
    .select('case_id, source_id, raw_payload')
    .order('last_ingested_at', { ascending: false })
    .limit(opts.caseLimit ?? 100);

  if (!pending) return { scanned, inserted };

  for (const row of pending) {
    scanned += 1;
    const photoUrls = extractPhotoUrlsFromPayload(row.raw_payload);
    if (!photoUrls.length) continue;

    const photos: ExtractedPhoto[] = photoUrls.map((url) => ({
      url,
      kind: 'photo_victim' as MediaKind,
    }));

    const r = await cacheMediaForCase(
      { supabase, caseId: row.case_id, sourceId: row.source_id, fetcher },
      photos,
    );
    inserted += r.inserted;
  }

  return { scanned, inserted };
}

function extractPhotoUrlsFromPayload(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as { photos?: unknown };
  if (!Array.isArray(p.photos)) return [];
  return p.photos.filter((u): u is string => typeof u === 'string');
}
