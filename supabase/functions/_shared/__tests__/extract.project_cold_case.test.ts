import { describe, expect, it } from 'vitest';
import { classifyPccUrl } from '../../../../sources/project_cold_case.ts';

// PCC URL classification — three branches per the comment block in
// sources/project_cold_case.ts:
//   victim         — original case file, normal extraction
//   status-update  — post about an existing case's resolution
//   editorial      — generic content (Grief Diaries, fundraisers, etc.)

describe('classifyPccUrl — victim posts (the default path)', () => {
  it.each([
    'https://projectcoldcase.org/2018/05/07/shirley-badger-trenner/',
    'https://projectcoldcase.org/2017/05/01/alonzo-thomas-iv/',
    'https://projectcoldcase.org/2020/03/15/jane-smith/?pcc_id=12345',
  ])('classifies plain victim-name slug as victim: %s', (url) => {
    expect(classifyPccUrl(url).class).toBe('victim');
  });

  it('falls through to victim when URL has no recognizable PCC path', () => {
    expect(classifyPccUrl('https://projectcoldcase.org/').class).toBe('victim');
  });
});

describe('classifyPccUrl — status-update posts', () => {
  it('classifies "arrests-made-in-X-case" as cleared_arrest', () => {
    const r = classifyPccUrl(
      'https://projectcoldcase.org/2018/03/22/arrests-made-in-richard-robinson-case/?pcc_id=23969',
      'Arrests Made in Richard Robinson Case',
    );
    expect(r.class).toBe('status-update');
    expect(r.statusUpdate?.status).toBe('cleared_arrest');
    expect(r.statusUpdate?.victimNameHint).toBe('Richard Robinson');
  });

  it('classifies singular "arrest-made-in-X-case" as cleared_arrest', () => {
    const r = classifyPccUrl(
      'https://projectcoldcase.org/2018/04/24/arrest-made-in-nikki-redden-case/?pcc_id=23974',
      'Arrest Made in Nikki Redden Case',
    );
    expect(r.class).toBe('status-update');
    expect(r.statusUpdate?.status).toBe('cleared_arrest');
    expect(r.statusUpdate?.victimNameHint).toBe('Nikki Redden');
  });

  it('classifies "arrest-made-solved-cold-case-spotlight-X" as cleared_arrest (the more-specific pattern wins)', () => {
    const r = classifyPccUrl(
      'https://projectcoldcase.org/2017/01/24/arrest-made-solved-cold-case-spotlight-corey-laykovich/?pcc_id=22955',
      'Arrest Made: Solved Cold Case Spotlight – Corey Laykovich',
    );
    expect(r.class).toBe('status-update');
    expect(r.statusUpdate?.status).toBe('cleared_arrest');
    expect(r.statusUpdate?.victimNameHint).toBe('Corey Laykovich');
  });

  it('classifies plain "solved-cold-case-spotlight-X" as cleared_other (kind-of-resolution unknown)', () => {
    const r = classifyPccUrl(
      'https://projectcoldcase.org/2016/10/31/solved-cold-case-spotlight-jamal-fleming/?pcc_id=22762',
      'Solved Cold Case Spotlight – Jamal Fleming',
    );
    expect(r.class).toBe('status-update');
    expect(r.statusUpdate?.status).toBe('cleared_other');
    expect(r.statusUpdate?.victimNameHint).toBe('Jamal Fleming');
  });

  it('classifies "update-solved-cold-case-spotlight-X" as cleared_other', () => {
    const r = classifyPccUrl(
      'https://projectcoldcase.org/2018/01/15/update-solved-cold-case-spotlight-rebekah-bletsch/',
      'Update: Solved Cold Case Spotlight – Rebekah Bletsch',
    );
    expect(r.class).toBe('status-update');
    expect(r.statusUpdate?.status).toBe('cleared_other');
    expect(r.statusUpdate?.victimNameHint).toBe('Rebekah Bletsch');
  });

  it('returns null victimNameHint when title is missing (URL-only classification)', () => {
    const r = classifyPccUrl(
      'https://projectcoldcase.org/2018/04/24/arrest-made-in-nikki-redden-case/',
    );
    expect(r.class).toBe('status-update');
    expect(r.statusUpdate?.status).toBe('cleared_arrest');
    expect(r.statusUpdate?.victimNameHint).toBeNull();
  });

  it('returns null victimNameHint when title doesn\'t match any known pattern', () => {
    const r = classifyPccUrl(
      'https://projectcoldcase.org/2018/04/24/arrest-made-in-nikki-redden-case/',
      'This is some unrelated title that does not match',
    );
    expect(r.class).toBe('status-update');
    expect(r.statusUpdate?.victimNameHint).toBeNull();
  });
});

describe('classifyPccUrl — editorial-noise posts', () => {
  it.each([
    [
      'https://projectcoldcase.org/2016/07/24/arrests-dont-always-equal-justice/',
      "Arrests Don't Always Equal Justice",
    ],
    [
      'https://projectcoldcase.org/2017/06/12/grief-diaries-project-cold-case/',
      'Grief Diaries: Project Cold Case',
    ],
    [
      'https://projectcoldcase.org/2018/08/03/2nd-annual-year-of-hope-fundraiser/',
      '2nd Annual Year of Hope Fundraiser',
    ],
    [
      'https://projectcoldcase.org/2019/09/15/3rd-annual-year-of-hope/',
      '3rd Annual Year of Hope',
    ],
    [
      'https://projectcoldcase.org/2020/05/15/year-of-hope-2020/',
      'Year of Hope 2020',
    ],
  ])('classifies %s as editorial', (url) => {
    expect(classifyPccUrl(url).class).toBe('editorial');
  });

  it('takes precedence over status-update — editorial check runs first', () => {
    // "arrests-dont-always-equal-justice" starts with "arrests" but is
    // editorial commentary, not a per-case status update. The editorial
    // patterns must be checked before the status-update patterns.
    const r = classifyPccUrl(
      'https://projectcoldcase.org/2016/07/24/arrests-dont-always-equal-justice/',
    );
    expect(r.class).toBe('editorial');
  });
});

describe('classifyPccUrl — boundary cases', () => {
  it('does not classify "annual-checkup" as editorial (would over-match without the slug-start anchor)', () => {
    // Defensive: a real victim case whose slug happens to start with
    // "annual-checkup-…" shouldn't get caught by the \d+(st|nd|rd|th)?-annual
    // pattern. Sanity check that the patterns are anchored correctly.
    const r = classifyPccUrl(
      'https://projectcoldcase.org/2020/01/01/annual-checkup/',
    );
    // "annual" without the leading number prefix isn't matched by the
    // editorial pattern → classified as victim.
    expect(r.class).toBe('victim');
  });

  it('handles URLs with query strings and fragments', () => {
    const r = classifyPccUrl(
      'https://projectcoldcase.org/2018/03/22/arrests-made-in-richard-robinson-case/?pcc_id=23969#section',
      'Arrests Made in Richard Robinson Case',
    );
    expect(r.class).toBe('status-update');
    expect(r.statusUpdate?.victimNameHint).toBe('Richard Robinson');
  });

  it('handles em-dash and hyphen separators in titles', () => {
    const emDash = classifyPccUrl(
      'https://projectcoldcase.org/2017/01/24/solved-cold-case-spotlight-jane-doe/',
      'Solved Cold Case Spotlight – Jane Doe', // – is en-dash, common in PCC titles
    );
    expect(emDash.statusUpdate?.victimNameHint).toBe('Jane Doe');

    const hyphen = classifyPccUrl(
      'https://projectcoldcase.org/2017/01/24/solved-cold-case-spotlight-jane-doe/',
      'Solved Cold Case Spotlight - Jane Doe',
    );
    expect(hyphen.statusUpdate?.victimNameHint).toBe('Jane Doe');

    const colon = classifyPccUrl(
      'https://projectcoldcase.org/2017/01/24/solved-cold-case-spotlight-jane-doe/',
      'Solved Cold Case Spotlight: Jane Doe',
    );
    expect(colon.statusUpdate?.victimNameHint).toBe('Jane Doe');
  });
});
