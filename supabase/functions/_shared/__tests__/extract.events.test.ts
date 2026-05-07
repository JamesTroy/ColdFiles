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

  it('emits status_resolved_other event when case is closed (no remains_found without a date)', () => {
    // is_closed='X' carries through with status='cleared_other' (PR #19).
    // The status flip itself emits a timeline event with 'approximate'
    // quality + a stable event_date_text anchor, since Doe has no
    // publish-date for the close. remains_found stays suppressed because
    // date_of_discovery is absent — the editorial-noise rule: no
    // upstream date signal → no remains_found row.
    const out = doeNetworkUid.detail.mapJson(
      {
        fields: { id: '9001UMCA', is_closed: 'X' },
        agencies: [],
        images: [],
      },
      detailUrl,
    );
    expect(out.events).toHaveLength(1);
    const ev = out.events![0];
    expect(ev.event_kind).toBe('status_resolved_other');
    expect(ev.event_date_quality).toBe('approximate');
    expect(ev.event_date_text).toMatch(/Doe Network/);
    expect(ev.source_quote).toBe('is_closed: X');
  });

  it('emits incident event from estimated_date_of_death when present', () => {
    // Doe sometimes provides an estimated date of death — usually
    // approximate ("circa 1985") or year-only ("2003"). When the date
    // parses, we surface it as an incident timeline event with the
    // upstream value preserved verbatim in event_date_text.
    const out = doeNetworkUid.detail.mapJson(
      {
        fields: {
          id: '9001UMCA',
          estimated_date_of_death: 'circa 1985',
        },
        agencies: [],
        images: [],
      },
      detailUrl,
    );
    const incidents = (out.events ?? []).filter((e) => e.event_kind === 'incident');
    expect(incidents).toHaveLength(1);
    expect(incidents[0].headline).toBe('Estimated date of death');
    expect(incidents[0].event_date_text).toBe('circa 1985');
    expect(incidents[0].source_quote).toBe('Estimated Date of Death: circa 1985');
  });

  it('does not emit an incident event when estimated_date_of_death is "Unknown"', () => {
    // Sentinel-text "Unknown" is Doe's no-data placeholder. Treating
    // it as a valid date would litter the timeline with empty rows.
    const out = doeNetworkUid.detail.mapJson(
      {
        fields: {
          id: '9001UMCA',
          estimated_date_of_death: 'Unknown',
        },
        agencies: [],
        images: [],
      },
      detailUrl,
    );
    const incidents = (out.events ?? []).filter((e) => e.event_kind === 'incident');
    expect(incidents).toHaveLength(0);
  });

  it('emits status_identified event when is_identified=X', () => {
    // Doe UID's identification signal is the structurally cleanest of
    // the three status events — when a Doe is identified, a real-name
    // case sometimes lives in a missing-person feed that another scrape
    // ingested. The status_identified event marks the moment in the
    // timeline; future tooling could cross-link the named record.
    const out = doeNetworkUid.detail.mapJson(
      {
        fields: { id: '9001UMCA', is_identified: 'X' },
        agencies: [],
        images: [],
      },
      detailUrl,
    );
    expect(out.events).toHaveLength(1);
    const ev = out.events![0];
    expect(ev.event_kind).toBe('status_identified');
    expect(ev.headline).toBe('Victim identified');
    expect(ev.source_quote).toBe('is_identified: X');
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

  it('emits status_resolved_arrest event from /arrest-made-in-X/ status-update post', () => {
    // The URL classifier flags arrest-made-* slugs as status-update
    // posts that should merge into the existing victim case + emit a
    // timeline event documenting the arrest. Headline is editorial
    // ("Arrest made"); source_quote is the yoast description sentence
    // verbatim (the editorial milestone PCC published).
    const out = projectColdCase.detail.mapJson(
      {
        post: {
          id: 999,
          slug: 'arrest-made-in-richard-robinson-case',
          link: 'https://projectcoldcase.org/2026/03/01/arrest-made-in-richard-robinson-case/',
          date: '2026-03-01T12:00:00',
          title: { rendered: 'Arrests Made in Richard Robinson Case' },
          yoast_head_json: {
            description: 'On March 1, 2026, the LASD arrested two suspects in the death of Richard Robinson.',
            article_published_time: '2026-03-01T12:00:00+00:00',
          },
        },
      },
      // The PCC URL classifier reads the SLUG of the post URL, not
      // the API endpoint URL, so the detailUrl here must be the
      // user-facing /YYYY/MM/DD/<slug>/ form.
      'https://projectcoldcase.org/2026/03/01/arrest-made-in-richard-robinson-case/?pcc_id=999',
    );
    expect(out.status_update_only).toBe(true);
    expect(out.status).toBe('cleared_arrest');
    expect(out.events).toHaveLength(1);
    const ev = out.events![0];
    expect(ev.event_kind).toBe('status_resolved_arrest');
    expect(ev.headline).toBe('Arrest made');
    expect(ev.event_at).toBe('2026-03-01T12:00:00+00:00');
    expect(ev.event_date).toBe('2026-03-01');
    expect(ev.event_date_quality).toBe('exact');
    expect(ev.source_url).toBe('https://projectcoldcase.org/2026/03/01/arrest-made-in-richard-robinson-case/');
    expect(ev.source_quote).toMatch(/LASD arrested/);
  });

  it('emits status_resolved_other event from /solved-cold-case-spotlight-X/ post', () => {
    const out = projectColdCase.detail.mapJson(
      {
        post: {
          id: 1000,
          slug: 'solved-cold-case-spotlight-someone',
          link: 'https://projectcoldcase.org/2026/03/01/solved-cold-case-spotlight-someone/',
          date: '2026-03-01T12:00:00',
          title: { rendered: 'Solved Cold Case Spotlight – Someone' },
          yoast_head_json: {
            description: 'After 30 years, the murder of Someone has been solved.',
            article_published_time: '2026-03-01T12:00:00+00:00',
          },
        },
      },
      'https://projectcoldcase.org/2026/03/01/solved-cold-case-spotlight-someone/?pcc_id=1000',
    );
    expect(out.status_update_only).toBe(true);
    expect(out.status).toBe('cleared_other');
    expect(out.events).toHaveLength(1);
    expect(out.events![0].event_kind).toBe('status_resolved_other');
    expect(out.events![0].headline).toBe('Case marked resolved');
  });
});

describe('doe network MP — status_resolved_other event', () => {
  // Pulls in the doe_network MP extractor (not exported in the
  // doe_network_uid block above).
  it('emits status_resolved_other when is_closed=X', async () => {
    const { doeNetwork } = await import('../../../../sources/doe_network.ts');
    if (doeNetwork.detail.kind !== 'json') throw new Error('expected json detail strategy');
    const detailUrl =
      'https://www.doenetwork.org/cases/software/php/mpdatabase.php?id=999CLOSE&fields=true';
    const out = doeNetwork.detail.mapJson(
      {
        fields: {
          id: '999CLOSE',
          pname: 'Test Person',
          is_closed: 'X',
        },
        agencies: [],
        images: [],
      },
      detailUrl,
    );
    // status_resolved_other event lands even without missing_since
    // (the close itself is the structural signal).
    const statusEvents = (out.events ?? []).filter(
      (e) => e.event_kind === 'status_resolved_other',
    );
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0].event_date_quality).toBe('approximate');
    expect(statusEvents[0].event_date_text).toMatch(/Doe Network/);
    expect(statusEvents[0].source_quote).toBe('is_closed: X');
    expect(statusEvents[0].source_url).toBe(detailUrl);
  });
});
