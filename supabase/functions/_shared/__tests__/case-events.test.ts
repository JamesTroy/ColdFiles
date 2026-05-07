import { describe, expect, it, vi } from 'vitest';
import { computeEventSignature, persistCaseEvents } from '../case-events.ts';
import type { CaseEventInput } from '../case-events.ts';

// computeEventSignature pins the schema-side hash composition. If the
// migration 35 column comment says sha256(source_url|event_kind|date_floor),
// this test is the runtime witness that the TypeScript implementation
// matches. Drift between the comment and the function is the bug class
// the test exists to catch.

describe('computeEventSignature — schema/runtime parity', () => {
  it('hashes (source_url|event_kind|event_date) for a date-precision event', async () => {
    const sig = await computeEventSignature({
      source_url: 'https://example.com/case/1',
      event_kind: 'last_seen',
      event_date: '1985-06-13',
    });
    // Stable hex of 'https://example.com/case/1|last_seen|1985-06-13'.
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    // Pin one byte to catch accidental input-shape regressions.
    const expected = await sha256Hex('https://example.com/case/1|last_seen|1985-06-13');
    expect(sig).toBe(expected);
  });

  it('prefers event_date_text over event_date when both are present', async () => {
    // Free-form date text is the user-visible signal and the de-facto
    // identity when a date can't be machine-encoded ("summer 1985").
    // Including event_date in the hash for those rows would make a
    // re-scrape that improves date parsing produce a duplicate event.
    const sig = await computeEventSignature({
      source_url: 'https://example.com/case/1',
      event_kind: 'incident',
      event_date: '1985-06-15',
      event_date_text: 'summer 1985',
    });
    const expected = await sha256Hex(
      'https://example.com/case/1|incident|summer 1985',
    );
    expect(sig).toBe(expected);
  });

  it('coerces missing date to empty string (matches SQL coalesce(..., ""))', async () => {
    // The migration body comment is explicit: coalesce(event_date_text,
    // event_date::text, ''). An undated event gets a stable signature
    // keyed only on (source_url, event_kind) — duplicate-undated events
    // from the same source for the same case would be elided, which is
    // the right behavior since we have no way to tell them apart.
    const sig = await computeEventSignature({
      source_url: 'https://example.com/case/1',
      event_kind: 'case_spotlight_published',
    });
    const expected = await sha256Hex(
      'https://example.com/case/1|case_spotlight_published|',
    );
    expect(sig).toBe(expected);
  });

  it('different event_kind produces a different signature for same url+date', async () => {
    // Two events in different kinds at the same URL + date are valid
    // (e.g., a status flip and a spotlight publish on the same day);
    // the hash MUST differ so both rows can land.
    const a = await computeEventSignature({
      source_url: 'https://example.com/case/1',
      event_kind: 'status_resolved_arrest',
      event_date: '2026-01-15',
    });
    const b = await computeEventSignature({
      source_url: 'https://example.com/case/1',
      event_kind: 'case_spotlight_published',
      event_date: '2026-01-15',
    });
    expect(a).not.toBe(b);
  });
});

// Helper that dodges the export-order constraint (sha256Hex is in http.ts).
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface UpsertCall {
  rows: Record<string, unknown>[];
  options: Record<string, unknown> | undefined;
}

function buildEventsMockSupabase(): {
  client: any;
  upsertCalls: UpsertCall[];
  warnings: string[];
} {
  const upsertCalls: UpsertCall[] = [];
  const warnings: string[] = [];
  const client = {
    from: (table: string) => {
      if (table !== 'case_events') {
        // Helps tests fail loudly if persistCaseEvents accidentally writes
        // somewhere unexpected — no silent miss.
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        upsert: (
          rows: Record<string, unknown>[],
          options?: Record<string, unknown>,
        ) => {
          upsertCalls.push({ rows, options });
          return Promise.resolve({ data: rows, error: null });
        },
      };
    },
  };
  return { client, upsertCalls, warnings };
}

describe('persistCaseEvents', () => {
  const ctx = (client: any) => ({ supabase: client, sourceId: 'src-id-fake' });

  it('no-op on empty input', async () => {
    const { client, upsertCalls } = buildEventsMockSupabase();
    await persistCaseEvents(ctx(client), 'case-1', []);
    await persistCaseEvents(ctx(client), 'case-1', undefined);
    expect(upsertCalls).toHaveLength(0);
  });

  it('writes one row per event with computed ingest_signature', async () => {
    const { client, upsertCalls } = buildEventsMockSupabase();
    const events: CaseEventInput[] = [
      {
        event_kind: 'last_seen',
        headline: 'Last seen in Reno, NV',
        event_date: '1985-06-13',
        event_date_quality: 'exact',
        source_url: 'https://example.com/case/1',
        source_quote: 'Missing Since: June 13, 1985',
      },
      {
        event_kind: 'remains_found',
        headline: 'Remains discovered',
        event_date: '1987-04-02',
        event_date_quality: 'exact',
        source_url: 'https://example.com/case/1',
        source_quote: 'Date of Discovery: April 2, 1987',
      },
    ];
    await persistCaseEvents(ctx(client), 'case-1', events);

    expect(upsertCalls).toHaveLength(1);
    const { rows, options } = upsertCalls[0];
    expect(rows).toHaveLength(2);
    expect(options).toEqual({
      onConflict: 'case_id,ingest_signature',
      ignoreDuplicates: true,
    });
    expect(rows[0].case_id).toBe('case-1');
    expect(rows[0].event_kind).toBe('last_seen');
    expect(rows[0].source_id).toBe('src-id-fake');
    expect(rows[0].ingest_signature).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].ingest_signature).not.toBe(rows[1].ingest_signature);
  });

  it('skips events missing source_url or source_quote with a structured warning', async () => {
    // Migration 35 enforces NOT NULL on both. Defensive-skip at this layer
    // surfaces a buggy extractor as a recognizable warning rather than a
    // batch-killing PG error. The editorial-noise rule says these columns
    // are load-bearing — a row missing them shouldn't silently land even
    // if the schema didn't reject.
    const { client, upsertCalls } = buildEventsMockSupabase();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await persistCaseEvents(ctx(client), 'case-1', [
        {
          event_kind: 'incident',
          headline: 'Incident',
          source_url: '',
          source_quote: 'something',
        } as CaseEventInput,
        {
          event_kind: 'incident',
          headline: 'Incident OK',
          source_url: 'https://example.com/case/1',
          source_quote: 'Incident on June 13, 1985',
        },
      ]);
      // Only the well-formed row landed.
      expect(upsertCalls).toHaveLength(1);
      expect(upsertCalls[0].rows).toHaveLength(1);
      expect(upsertCalls[0].rows[0].headline).toBe('Incident OK');

      const skipped = warnSpy.mock.calls.some((args) => {
        const line = String(args[0] ?? '');
        return line.includes('skipping event missing source_url or source_quote');
      });
      expect(skipped).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('defaults event_date_quality to "unknown" when omitted', async () => {
    const { client, upsertCalls } = buildEventsMockSupabase();
    await persistCaseEvents(ctx(client), 'case-1', [
      {
        event_kind: 'case_spotlight_published',
        headline: 'Spotlight published',
        source_url: 'https://example.com/case/1',
        source_quote: 'Published 2026-01-15',
      },
    ]);
    expect(upsertCalls[0].rows[0].event_date_quality).toBe('unknown');
  });

  it('event without a date still hashes deterministically (matches SQL coalesce-empty)', async () => {
    const { client, upsertCalls } = buildEventsMockSupabase();
    await persistCaseEvents(ctx(client), 'case-1', [
      {
        event_kind: 'case_spotlight_published',
        headline: 'Spotlight',
        source_url: 'https://example.com/case/1',
        source_quote: 'Published',
      },
    ]);
    const expected = await sha256Hex(
      'https://example.com/case/1|case_spotlight_published|',
    );
    expect(upsertCalls[0].rows[0].ingest_signature).toBe(expected);
  });

  it('upsert error → structured warning, does not throw', async () => {
    // Timeline is additive UI material; a write failure must not roll back
    // the case row write. Surface as a structured warning so a debug session
    // can spot the failed batch without a noisy stack trace mid-scrape.
    const upsertCalls: UpsertCall[] = [];
    const client = {
      from: () => ({
        upsert: (
          rows: Record<string, unknown>[],
          options?: Record<string, unknown>,
        ) => {
          upsertCalls.push({ rows, options });
          return Promise.resolve({
            data: null,
            error: { message: 'simulated postgres error' },
          });
        },
      }),
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(
        persistCaseEvents({ supabase: client as any, sourceId: 'src-id-fake' }, 'case-1', [
          {
            event_kind: 'incident',
            headline: 'Incident',
            source_url: 'https://example.com/case/1',
            source_quote: 'Incident on 1985',
          },
        ]),
      ).resolves.toBeUndefined();
      const logged = warnSpy.mock.calls.some((args) => {
        const line = String(args[0] ?? '');
        return line.includes('persistCaseEvents: upsert failed') &&
          line.includes('simulated postgres error');
      });
      expect(logged).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
