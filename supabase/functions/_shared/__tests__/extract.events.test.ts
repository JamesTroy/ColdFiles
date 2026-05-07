// Per-source event emission for the Timeline Reconstruction (PR #16).
//
// Doe Network MP + Charley already cover the last_seen path in their
// existing fixture-backed tests (extract.doe_network.test.ts /
// extract.charley.test.ts). This file pins the remaining sources:
//   - doe_network_uid (remains_found from date_of_discovery)
//   - project_cold_case (incident from yoast description; case_spotlight_published
//                        from yoast.article_published_time)
//
// Synthetic JSON only — no fixture files. The shapes here are deliberately
// minimal; broader extraction is covered by mapJson's own selector tests
// once the sources earn fixture-backed test files.

import { describe, expect, it } from 'vitest';
import { doeNetworkUid } from '../../../../sources/doe_network_uid.ts';
import { projectColdCase } from '../../../../sources/project_cold_case.ts';

describe('doe network UID — remains_found event', () => {
  if (doeNetworkUid.detail.kind !== 'json') throw new Error('expected json detail strategy');

  const detailUrl =
    'https://www.doenetwork.org/cases/software/php/database.php?id=9001UMCA&fields=true';

  it('emits one remains_found event when date_of_discovery parsed exact', () => {
    const out = doeNetworkUid.detail.mapJson(
      {
        fields: {
          id: '9001UMCA',
          date_of_discovery: 'April 2, 1987',
          location_of_discovery: 'Claremont, Los Angeles County, California',
          sex: 'Male',
        },
        agencies: [],
        images: [],
      },
      detailUrl,
    );
    expect(out.events).toBeDefined();
    expect(out.events).toHaveLength(1);
    const ev = out.events![0];
    expect(ev.event_kind).toBe('remains_found');
    expect(ev.event_date).toBe('1987-04-02');
    expect(ev.event_date_quality).toBe('exact');
    expect(ev.source_url).toBe(detailUrl);
    expect(ev.source_quote).toBe('Date of Discovery: April 2, 1987');
    expect(ev.headline).toBe(
      'Remains discovered — Claremont, Los Angeles County, California',
    );
  });

  it('falls back to "Remains discovered" headline when location is unknown', () => {
    const out = doeNetworkUid.detail.mapJson(
      {
        fields: {
          id: '9001UMCA',
          date_of_discovery: 'April 2, 1987',
          location_of_discovery: 'Unknown',
        },
        agencies: [],
        images: [],
      },
      detailUrl,
    );
    expect(out.events![0].headline).toBe('Remains discovered');
  });

  it('does not emit an event when date_of_discovery is absent', () => {
    const out = doeNetworkUid.detail.mapJson(
      {
        fields: { id: '9001UMCA' },
        agencies: [],
        images: [],
      },
      detailUrl,
    );
    expect(out.events ?? []).toHaveLength(0);
  });

  it('does not emit an event when the case is closed (skip path)', () => {
    const out = doeNetworkUid.detail.mapJson(
      {
        fields: { id: '9001UMCA', is_closed: 'X' },
        agencies: [],
        images: [],
      },
      detailUrl,
    );
    // mapJson short-circuits to a stub; no events on the partial.
    expect(out.events).toBeUndefined();
  });
});

describe('project_cold_case — incident + case_spotlight_published events', () => {
  if (projectColdCase.detail.kind !== 'json') throw new Error('expected json detail strategy');

  const detailUrl = 'https://projectcoldcase.org/wp-json/wp/v2/posts/123';

  it('emits both events when yoast description parses + article_published_time present', () => {
    const out = projectColdCase.detail.mapJson(
      {
        post: {
          id: 123,
          slug: 'edward-mcclain',
          link: 'https://projectcoldcase.org/2026/04/27/edward-mcclain/',
          date: '2026-04-27T12:00:00',
          title: { rendered: 'Edward McClain' },
          content: { rendered: '<p>Edward McClain went missing...</p>' },
          yoast_head_json: {
            description:
              'Edward McClain went missing from the 1600 block of Colgate Road in Jacksonville, FL on November 20, 2000 and has not been heard from since.',
            article_published_time: '2026-04-27T12:00:00+00:00',
          },
        },
      },
      detailUrl,
    );
    expect(out.events).toBeDefined();
    expect(out.events).toHaveLength(2);

    const incident = out.events!.find((e) => e.event_kind === 'incident');
    expect(incident).toBeDefined();
    expect(incident!.event_date).toBe('2000-11-20');
    expect(incident!.event_date_quality).toBe('exact');
    expect(incident!.source_url).toBe('https://projectcoldcase.org/2026/04/27/edward-mcclain/');
    expect(incident!.headline).toBe('Incident — Jacksonville, FL');
    // source_quote is the verbatim Yoast description sentence — the
    // editorial-noise rule's "extractor must quote upstream text"
    // discipline.
    expect(incident!.source_quote).toMatch(/Edward McClain went missing/);

    const published = out.events!.find((e) => e.event_kind === 'case_spotlight_published');
    expect(published).toBeDefined();
    expect(published!.event_date).toBe('2026-04-27');
    expect(published!.event_at).toBe('2026-04-27T12:00:00+00:00');
    expect(published!.event_date_quality).toBe('exact');
    expect(published!.source_quote).toBe('Article published: 2026-04-27T12:00:00+00:00');
  });

  it('emits only case_spotlight_published when description has no parseable date', () => {
    const out = projectColdCase.detail.mapJson(
      {
        post: {
          id: 123,
          slug: 'someone-undated',
          link: 'https://projectcoldcase.org/2026/04/27/someone-undated/',
          date: '2026-04-27T12:00:00',
          title: { rendered: 'Someone Undated' },
          content: { rendered: '<p>Body</p>' },
          yoast_head_json: {
            description: 'A short summary with no parseable date.',
            article_published_time: '2026-04-27T12:00:00+00:00',
          },
        },
      },
      detailUrl,
    );
    expect(out.events).toHaveLength(1);
    expect(out.events![0].event_kind).toBe('case_spotlight_published');
  });

  it('emits no events when both yoast fields absent (skip-able post)', () => {
    const out = projectColdCase.detail.mapJson(
      {
        post: {
          id: 123,
          slug: 'no-yoast',
          link: 'https://projectcoldcase.org/2026/04/27/no-yoast/',
          date: '2026-04-27T12:00:00',
          title: { rendered: 'No Yoast' },
          content: { rendered: '<p>Body</p>' },
        },
      },
      detailUrl,
    );
    expect(out.events ?? []).toHaveLength(0);
  });

  it('skips the editorial summary post (Cold Case Spotlight – <Name>)', () => {
    // The defensive title-heuristic in mapJson short-circuits to a stub;
    // events should not be emitted on those rows.
    const out = projectColdCase.detail.mapJson(
      {
        post: {
          id: 123,
          slug: 'cold-case-spotlight-summary',
          link: 'https://projectcoldcase.org/cold-case-spotlight-summary/',
          date: '2026-04-27T12:00:00',
          title: { rendered: 'Cold Case Spotlight – Summary' },
          yoast_head_json: {
            description: 'On April 5, 2018, deputies responded to gunfire in Gainesville, FL.',
            article_published_time: '2026-04-27T12:00:00+00:00',
          },
        },
      },
      detailUrl,
    );
    expect(out.events).toBeUndefined();
  });
});
