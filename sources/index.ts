// Source registry. Every active source must be re-exported here.
// The runner dispatches by slug, so this file is the single source of truth
// for "which sources are wired in."

import type { SourceConfig } from '../supabase/functions/_shared/types.ts';
import { caMups } from './ca_mups.ts';
import { charleyProject } from './charley.ts';
import { doeNetwork } from './doe_network.ts';
import { doeNetworkUid } from './doe_network_uid.ts';
import { fbiWanted } from './fbi_wanted.ts';
import { mtMmpd } from './mt_mmpd.ts';
import { namusUp } from './namus.ts';
import { nmDps } from './nm_dps.ts';
import { nysDcjs } from './ny_dcjs.ts';
import { projectColdCase } from './project_cold_case.ts';
import { txDps } from './tx_dps.ts';

export const SOURCES: SourceConfig[] = [
  caMups,
  charleyProject,
  doeNetwork,
  doeNetworkUid,
  fbiWanted,
  mtMmpd,
  namusUp,
  nmDps,
  nysDcjs,
  projectColdCase,
  txDps,
  // Follow-ups (deferred / dead):
  //   tx_dps unidentified — DEAD. Search is broken server-side, not a
  //     parameter issue: every filter combination (incl. searchCat=Search
  //     + known-existing CaseNumber=U0310026) returns the same 37,959-byte
  //     "No Search Results" response. Detail pages render fine when fetched
  //     directly (`/Unidentified/unDetails/{ID}` → 200 OK with full record),
  //     so the source isn't dark — only the index is. Probed 2026-05-10.
  //     Re-evaluate after a website overhaul. NamUs UP covers the same
  //     federal-registered TX records when it's woken up.
  //   fl_fdle (MEPIC) — READY TO BUILD. Probed 2026-05-10. Classic ASP.
  //     Robots fully open. Form requires `category` field (CheckForm() JS
  //     rejects all-empty). `category=All Categories` is the wildcard;
  //     POST also needs Search=Submit, ResultsViewRb=Original, lowercase
  //     user-input field names (fname, lname, county, city, agefrom,
  //     ageto, Race, Sex). Returns paginated table at /mcicsearch/Results.asp:
  //     168 pages × 5 records = ~840 records. Pagination via XSESSIONID
  //     (from first response) + XCURRENTPAGE on subsequent POSTs. Detail
  //     URL: Flyer.asp?ID={ID} → 302 to /Flyers/FlyerCust*.asp?ID={ID}
  //     (variant by case type). DOM is <td class="style38">LABEL:</td>
  //     <td>value</td> in nested <tr> rows. Photos via GetImage.asp?FIN={id}.
  //     Effort: 1-2 days when prioritized.
  //   lasd_homicide — probed 2026-05-02 and rejected (~3-4 bulletins, too
  //     thin for a scraper).
  //   lapd_unsolved — not yet evaluated.
];

export const SOURCE_BY_SLUG: Record<string, SourceConfig> = Object.fromEntries(
  SOURCES.map((s) => [s.slug, s]),
);

export function getSourceOrThrow(slug: string): SourceConfig {
  const s = SOURCE_BY_SLUG[slug];
  if (!s) {
    throw new Error(
      `Unknown source slug "${slug}". Known: ${Object.keys(SOURCE_BY_SLUG).join(', ')}`,
    );
  }
  return s;
}
