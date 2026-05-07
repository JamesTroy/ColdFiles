/**
 * CaseEventsSection — case-detail Timeline Reconstruction surface.
 *
 * Editorial framing (per migration 35 body comment): family members
 * of unidentified Does and missing persons can spot temporal
 * coincidence that aggregator narratives bury under prose. This is
 * NOT a forensic investigator timeline and NOT "true-crime browsing"
 * — it's a public-record timeline making a case legible to someone
 * arriving cold. Every row carries a verified source URL + verbatim
 * quote (schema-enforced anti-inference per migration 35).
 *
 * Render gate: ≥3 events. Below the threshold the section is
 * suppressed entirely — a one- or two-event "timeline" is just the
 * key-facts row repeated, and would inflate the screen with no signal.
 * Threshold is mobile-side UI policy (NOT a schema constraint) so
 * it can flex without a migration.
 *
 * Order: chronological ASCENDING (oldest first). The natural read for a
 * cold case is "this person went missing → spotlight published →
 * status flipped" — top-to-bottom across time. The case_events
 * (case_id, coalesce(event_at, event_date::timestamptz) desc) index
 * is bidirectional, so flipping later is cheap.
 *
 * Each event renders as:
 *   - mono date stamp on the left (year-prominent for cold cases)
 *   - serif headline + small meta-line (kind dot + source name)
 *   - tappable to open the source_url in the system browser
 *
 * Hooks-before-returns per CLAUDE.md.
 */

import { useMemo, type ReactElement } from 'react';
import { Linking, Pressable, View } from 'react-native';

import { tokens } from '@/constants/theme';
import { useCaseEvents } from '@/lib/hooks/use-case-events';
import type { CaseEventKind, CaseEventRow } from '@/lib/types/database';

import { Mono, MonoLabel, SansBody } from './text';

interface Props {
  caseId: string | null | undefined;
}

const RENDER_THRESHOLD = 3;

export function CaseEventsSection({ caseId }: Props): ReactElement | null {
  const { data: events, loading } = useCaseEvents(caseId);

  // Stable order even if the hook returns rows out of date order
  // (sample-data sometimes does). Hooks must run before any return.
  const ordered = useMemo(() => sortAscByDate(events), [events]);

  if (loading && ordered.length === 0) return null;
  if (ordered.length < RENDER_THRESHOLD) return null;

  return (
    <View style={{ paddingHorizontal: 16, marginTop: 22 }}>
      <MonoLabel
        size={tokens.size.monoChip}
        tracking={tokens.tracking.chip}
        color={tokens.color.text.secondary}
        style={{ marginBottom: 12 }}
      >
        TIMELINE
      </MonoLabel>
      {ordered.map((ev, idx) => (
        <EventRow
          key={ev.id}
          event={ev}
          isFirst={idx === 0}
          isLast={idx === ordered.length - 1}
        />
      ))}
    </View>
  );
}

function EventRow({
  event,
  isFirst,
  isLast,
}: {
  event: CaseEventRow;
  isFirst: boolean;
  isLast: boolean;
}) {
  const dateLabel = formatEventDate(event);
  const meta = formatMetaLine(event);
  const onPress = () => {
    if (event.source_url) void Linking.openURL(event.source_url);
  };
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${event.headline}, ${dateLabel}. Open source.`}
      hitSlop={6}
      style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
    >
      <View
        style={{
          flexDirection: 'row',
          paddingTop: isFirst ? 0 : 10,
          paddingBottom: 10,
          borderBottomWidth: isLast ? 0 : 0.5,
          borderBottomColor: tokens.color.border.subtle,
        }}
      >
        {/* Date column — mono, year-prominent */}
        <View style={{ width: 88, paddingTop: 2 }}>
          <Mono
            size={tokens.size.meta}
            style={{
              color: tokens.color.text.primary,
              letterSpacing: tokens.size.meta * 0.02,
            }}
          >
            {dateLabel}
          </Mono>
        </View>

        {/* Headline + meta column */}
        <View style={{ flex: 1 }}>
          <SansBody
            style={{
              fontSize: tokens.size.body,
              color: tokens.color.text.primary,
            }}
          >
            {event.headline}
          </SansBody>
          {meta ? (
            <Mono
              size={tokens.size.meta}
              style={{
                color: tokens.color.text.disabled,
                marginTop: 4,
              }}
            >
              {meta}
            </Mono>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

/* ---------- pure helpers ---------- */

function sortAscByDate(events: CaseEventRow[]): CaseEventRow[] {
  // Sort by (event_at if exact, else event_date) ascending. Events with
  // neither sort to the end so a malformed row doesn't capsize the order.
  return [...events].sort((a, b) => {
    const at = eventSortKey(a);
    const bt = eventSortKey(b);
    if (at == null && bt == null) return 0;
    if (at == null) return 1;
    if (bt == null) return -1;
    return at - bt;
  });
}

function eventSortKey(ev: CaseEventRow): number | null {
  const candidate = ev.event_at ?? ev.event_date;
  if (!candidate) return null;
  const ms = Date.parse(candidate);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Date label — year-prominent format ("JUN 13 · 1985"). The year is the
 * emotional content on a cold-case date; the cold-time-gravity surface
 * up-screen depends on the same convention.
 *
 * For approximate / year_only / suspect quality, we surface the
 * verbatim event_date_text when present (preserves "summer 1985",
 * "c. 1987-1988"). Otherwise fall back to a quality-appropriate
 * truncation of the parsed date.
 */
function formatEventDate(ev: CaseEventRow): string {
  if (ev.event_date_text && ev.event_date_quality !== 'exact') {
    return ev.event_date_text.toUpperCase();
  }
  if (ev.event_at) {
    return formatYmd(ev.event_at.slice(0, 10), ev.event_date_quality);
  }
  if (ev.event_date) {
    return formatYmd(ev.event_date, ev.event_date_quality);
  }
  return '— ';
}

function formatYmd(ymd: string, quality: CaseEventRow['event_date_quality']): string {
  const [yyyy, mm, dd] = ymd.split('-');
  const year = yyyy ?? '';
  if (quality === 'year_only' || !mm) return year;
  const monthName = MONTHS[parseInt(mm, 10) - 1];
  if (!monthName) return year;
  if (!dd || quality === 'approximate' || quality === 'suspect') {
    return `${monthName} · ${year}`;
  }
  return `${monthName} ${parseInt(dd, 10)} · ${year}`;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function formatMetaLine(ev: CaseEventRow): string | null {
  const kindLabel = KIND_LABEL[ev.event_kind];
  const sourceName = ev.source?.name ?? null;
  if (kindLabel && sourceName) return `${kindLabel} · ${sourceName.toUpperCase()}`;
  if (kindLabel) return kindLabel;
  if (sourceName) return sourceName.toUpperCase();
  return null;
}

const KIND_LABEL: Record<CaseEventKind, string> = {
  incident: 'INCIDENT',
  last_seen: 'LAST SEEN',
  remains_found: 'REMAINS FOUND',
  case_spotlight_published: 'PUBLISHED',
  status_resolved_arrest: 'ARREST',
  status_resolved_other: 'RESOLVED',
  status_identified: 'IDENTIFIED',
};
