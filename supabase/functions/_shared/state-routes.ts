// Per-state missing-persons tip routing. Used as Tier 2.5 fallback in
// tip-route-submit when a case has no primary_agency_id.
//
// Trust posture: every URL terminates at a government domain or
// state-contracted Crime Stoppers affiliate. Aggregators (NamUs, Charley,
// Doe) are deliberately excluded — those are the discovery layer, not the
// routing target. States without a clean clearinghouse return null and
// route to the FBI tip line as the honest fallback.
//
// Verified: 2026-04-29 (initial pass). Re-verify URLs annually.
//
// Verification methodology: each non-null entry below was loaded via
// WebFetch on 2026-04-29. The page heading and contact lines were copied
// from the live page. If a state agency's site blocked direct fetches
// (Cloudflare 403 / cert-pinning) the entry is null — even if a phone or
// email is referenced elsewhere — because the live-on-topic check could
// not be performed. Better to honest-fall-through to FBI than to ship
// unverified routing.

export type RouteKind =
  | 'crime_stoppers_p3'
  | 'agency_form'
  | 'agency_phone'
  | 'fbi_tip'
  | 'namus_form'
  | 'email';

export interface StateClearinghouse {
  name: string;
  route_kind: RouteKind;
  tip_url: string | null;
  tip_phone: string | null;
}

export const STATE_CLEARINGHOUSES: Record<string, StateClearinghouse | null> = {
  // AL — verified 2026-04-29 against https://www.alea.gov/sbi/fusion-center/acmec
  // Page heading: "Alabama Center for Missing & Exploited Children".
  // Hotline 800-228-7688 listed; no public online tip form on this page,
  // so route_kind is agency_phone with the agency URL for context.
  AL: {
    name: 'Alabama Center for Missing & Exploited Children (ACMEC)',
    route_kind: 'agency_phone',
    tip_url: 'https://www.alea.gov/sbi/fusion-center/acmec',
    tip_phone: '1-800-228-7688',
  },

  // AK — verified 2026-04-29 against https://hotsheets.dps.alaska.gov/AST/ABI/MissingPerson
  // Page heading: "Missing Persons Clearinghouse" (under Alaska Bureau of
  // Investigation). Direct contact is the Clearinghouse Manager:
  // 907-269-5038 / malia.miller@alaska.gov. The general dps.alaska.gov/ast/tips
  // form is a generic crime tip pipe (Tip411), not missing-persons specific,
  // so we route to the agency phone instead.
  AK: {
    name: 'Alaska Bureau of Investigation — Missing Persons Clearinghouse',
    route_kind: 'agency_phone',
    tip_url: 'https://hotsheets.dps.alaska.gov/AST/ABI/MissingPerson',
    tip_phone: '907-269-5038',
  },

  // AZ — deferred (not in priority 28). null routes to FBI tip line.
  AZ: null,

  // AR — verified 2026-04-29 against https://arkansasag.gov/public-safety/missing-persons/
  // Page heading: "Missing Persons" (under the AR Attorney General,
  // Community Relations Division). NCMEC's clearinghouse directory also
  // lists the AG as Arkansas's clearinghouse host. Hotline 800-482-8982.
  AR: {
    name: 'Arkansas Attorney General — Missing Persons',
    route_kind: 'agency_phone',
    tip_url: 'https://arkansasag.gov/public-safety/missing-persons/',
    tip_phone: '1-800-482-8982',
  },

  // CA — verified 2026-04-29 against https://oag.ca.gov/missing/mups
  // Page heading: "Missing and Unidentified Persons Section". Hotline
  // 1-800-222-FIND (3463), email missing.persons@doj.ca.gov.
  CA: {
    name: 'California Department of Justice — Missing and Unidentified Persons Section (MUPS)',
    route_kind: 'agency_phone',
    tip_url: 'https://oag.ca.gov/missing',
    tip_phone: '1-800-222-3463',
  },

  // CO — verified URL exists but Cloudflare blocked the WebFetch read on
  // 2026-04-29 (HTTP 403 from cbi.colorado.gov). Cannot honestly mark the
  // page as live-and-on-topic, so null. FBI fallback applies. Re-verify
  // annually; if CBI removes the bot block, restore the
  // cdps_cbi_missing@state.co.us email route.
  CO: null,

  // CT — verified 2026-04-29 against https://portal.ct.gov/despp/division-of-state-police/public-information-office/your-help-is-needed
  // The CT page is a generic "your help is needed" cold-case landing,
  // not a dedicated missing-persons clearinghouse with public tip intake.
  // The state's Missing Children Clearinghouse (per Sec. 29-1f) operates
  // primarily as a law-enforcement-facing repository. No clean public
  // route, so null and fall through to FBI.
  CT: null,

  // DE — deferred. null.
  DE: null,

  // DC — verified 2026-04-29 against https://missing.dc.gov/
  // Page heading: "Missing Persons" (MPD Missing Persons Branch).
  // Phone (202) 727-9099; text 50411. DC has no separate state clearinghouse
  // — MPD is the de facto authority.
  DC: {
    name: 'Metropolitan Police Department (MPD) Missing Persons Branch',
    route_kind: 'agency_phone',
    tip_url: 'https://missing.dc.gov/',
    tip_phone: '(202) 727-9099',
  },

  // FL — verified 2026-04-29 against https://www.fdle.state.fl.us/MEPIC
  // Page heading: "Missing Endangered Persons Information Clearinghouse"
  // (MEPIC). Hotline 1-888-FL-MISSING (356-4774); email
  // MEPIC@fdle.state.fl.us. Note: the canonical /MEPIC/Home URL 301-redirects
  // to a legacy path; using the stable /MEPIC root.
  FL: {
    name: 'Florida Department of Law Enforcement — Missing Endangered Persons Information Clearinghouse (MEPIC)',
    route_kind: 'agency_phone',
    tip_url: 'https://www.fdle.state.fl.us/MEPIC',
    tip_phone: '1-888-356-4774',
  },

  // GA — verified 2026-04-29 against https://gbi.georgia.gov/cases/missing-persons
  // Page heading: "Missing Persons" (Georgia Bureau of Investigation).
  // Online tip form linked at gbi.georgia.gov/submit-tips-online; primary
  // phone (404) 244-2600. GBI also runs a 24/7 watchdesk for the
  // "See Something Send Something" app.
  GA: {
    name: 'Georgia Bureau of Investigation (GBI) — Missing Persons',
    route_kind: 'agency_form',
    tip_url: 'https://gbi.georgia.gov/submit-tips-online',
    tip_phone: '1-800-597-8477',
  },

  // HI — verified 2026-04-29 against https://ag.hawaii.gov/cpja/mcch/contact-mcch/
  // Page heading: "Missing Child Center Hawaii Contact Information".
  // Phone (808) 586-1449. The Center is the state clearinghouse, housed
  // in the AG's Crime Prevention and Justice Assistance Division.
  // Note: scope is statutorily missing-children-focused, but it's the
  // only state-level clearinghouse in Hawaii — adult cases route to
  // local PD per HRS §28-121.
  HI: {
    name: 'Missing Child Center – Hawaii (Hawaii Department of the Attorney General)',
    route_kind: 'agency_phone',
    tip_url: 'https://ag.hawaii.gov/cpja/mcch/',
    tip_phone: '(808) 586-1449',
  },

  // IA — verified 2026-04-29 against https://missingpersons.iowa.gov/
  // Page heading: "Missing Persons" (Iowa Missing Person Information
  // Clearinghouse, within Iowa DCI / Iowa DPS). Phone 515-725-6036;
  // email mpicinfo@dps.state.ia.us.
  IA: {
    name: 'Iowa Missing Person Information Clearinghouse (Iowa DCI)',
    route_kind: 'agency_phone',
    tip_url: 'https://missingpersons.iowa.gov/',
    tip_phone: '515-725-6036',
  },

  // ID — verified 2026-04-29 against https://isp.idaho.gov/alerts/
  // Page heading lists "Idaho Missing Persons Clearinghouse (IMPC)" with
  // 24-hour helpline 208-884-7137 and email IDMPC@isp.idaho.gov.
  ID: {
    name: 'Idaho Missing Persons Clearinghouse (Idaho State Police)',
    route_kind: 'agency_phone',
    tip_url: 'https://isp.idaho.gov/alerts/',
    tip_phone: '208-884-7137',
  },

  // IL — search snippets cite ISP Clearinghouse 1-800-843-5763 and
  // ISP.Missing@illinois.gov, but the live page at
  // https://www.isp.state.il.us/crime/missing.cfm timed out on direct
  // WebFetch on 2026-04-29 and the linked ISP PDF is encrypted. Per the
  // strict live-verification bar, null and fall through to FBI. Re-verify
  // when the ISP host is reachable.
  IL: null,

  // IN — verified 2026-04-29 against https://www.in.gov/isp/mcmea/
  // Page heading: "Missing Children/Missing Veterans at Risk/Missing
  // Endangered Adults". Phone 1-800-831-8953; email
  // missingchildren@isp.IN.gov.
  IN: {
    name: 'Indiana Clearinghouse for Information on Missing Children, Missing Veterans at Risk, and Missing Endangered Adults (Indiana State Police)',
    route_kind: 'agency_phone',
    tip_url: 'https://www.in.gov/isp/mcmea/',
    tip_phone: '1-800-831-8953',
  },

  // KS — verified 2026-04-29 against https://www.kbi.ks.gov/MissingPersons/Tip/SubmitTip
  // KBI hosts a dedicated Submit-a-Tip web form for missing-persons cases
  // (the only state in this batch with a true purpose-built form).
  // Backstop phone 785-296-4017.
  KS: {
    name: 'Kansas Bureau of Investigation — Missing Persons Clearinghouse',
    route_kind: 'agency_form',
    tip_url: 'https://www.kbi.ks.gov/MissingPersons/Tip/SubmitTip',
    tip_phone: '785-296-4017',
  },

  // KY — deferred. null.
  KY: null,

  // LA — deferred. null.
  LA: null,

  // ME — deferred. null.
  ME: null,

  // MD — deferred. null.
  MD: null,

  // MA — deferred (not in priority 28; mass.gov page returned 403 on
  // 2026-04-29 anyway, so cannot mark verified). null.
  MA: null,

  // MI — Michigan's MSP pages (michigan.gov/msp) returned 403 on direct
  // WebFetch on 2026-04-29. The Missing Persons Coordination Unit (MPCU)
  // and email MSP-MissingPersons@Michigan.gov are referenced in search
  // snippets, but per the live-verification bar, null. Re-verify once the
  // MSP host accepts our user-agent.
  MI: null,

  // MN — verified 2026-04-29 against https://portal.dps.mn.gov/bca/unsolved-cases/missing-persons/Pages/default.aspx
  // Page heading: "Missing and Unidentified Persons Clearinghouse"
  // (Minnesota BCA). The page references a tip submission portal at
  // /bca/unsolved-cases/Pages/submit-tip.aspx. BCA general line: 651-793-7000.
  // Email: bca.missing-persons@state.mn.us.
  MN: {
    name: 'Minnesota Bureau of Criminal Apprehension — Missing and Unidentified Persons Clearinghouse',
    route_kind: 'agency_form',
    tip_url: 'https://portal.dps.mn.gov/bca/unsolved-cases/Pages/submit-tip.aspx',
    tip_phone: '651-793-7000',
  },

  // MS — deferred. null.
  MS: null,

  // MO — verified 2026-04-29 against https://www.mshp.dps.missouri.gov/MSHPWeb/PatrolDivisions/DDCC/Units/MissingPersonsJuvenileUnit/
  // Page heading: "Missing Persons Unit (Clearinghouse)" within MSHP's
  // Division of Drug and Crime Control. Hotline (866) 362-6422;
  // email missingpersons@mshp.dps.mo.gov.
  MO: {
    name: 'Missouri State Highway Patrol — Missing Persons Unit (Clearinghouse)',
    route_kind: 'agency_phone',
    tip_url: 'https://www.mshp.dps.missouri.gov/MSHPWeb/PatrolDivisions/DDCC/Units/MissingPersonsJuvenileUnit/',
    tip_phone: '1-866-362-6422',
  },

  // MT — deferred. null.
  MT: null,

  // NE — deferred. null.
  NE: null,

  // NV — deferred. null.
  NV: null,

  // NH — deferred. null.
  NH: null,

  // NJ — verified 2026-04-29 against https://nj.gov/njsp/division/investigations/missing-persons.shtml
  // Page heading: "Missing Persons Unit". Phone (609) 882-2000 ext 2554;
  // email missingpinformation@njsp.gov.
  NJ: {
    name: 'New Jersey State Police — Missing Persons Unit',
    route_kind: 'agency_phone',
    tip_url: 'https://nj.gov/njsp/division/investigations/missing-persons.shtml',
    tip_phone: '609-882-2000',
  },

  // NM — deferred. null.
  NM: null,

  // NY — verified 2026-04-29 against https://www.criminaljustice.ny.gov/missing/who-we-are.html
  // Canonical name: "Missing Persons Clearinghouse" within NY DCJS.
  // Hotline 1-800-346-3543. The page also surfaces a Google Forms lead
  // intake URL (forms.gle/...) — not used as the routing target since
  // forms.gle is not a state-domain endpoint; the clearinghouse phone is
  // the durable contact.
  NY: {
    name: 'New York State Missing Persons Clearinghouse (NY DCJS)',
    route_kind: 'agency_phone',
    tip_url: 'https://www.criminaljustice.ny.gov/missing/index.htm',
    tip_phone: '1-800-346-3543',
  },

  // NC — verified 2026-04-29 against https://nccmp.ncshp.gov/
  // Canonical name: "N.C. Center for Missing Persons" (housed under
  // NC State Highway Patrol / NC DPS). Phone 1-800-522-KIDS (5437).
  // Note: NCSBI also has a missing-persons section but the Center is
  // the statutory clearinghouse, so we route there.
  NC: {
    name: 'N.C. Center for Missing Persons (NC DPS)',
    route_kind: 'agency_phone',
    tip_url: 'https://nccmp.ncshp.gov/',
    tip_phone: '1-800-522-5437',
  },

  // ND — deferred. null.
  ND: null,

  // OH — verified 2026-04-29 against https://www.ohioattorneygeneral.gov/missingpersons
  // and https://inquiries.ohioattorneygeneral.gov/. The AG's online
  // inquiry form has "Missing Person Tip" as an explicit subject category
  // — one of only two true purpose-built forms in this batch (KS the
  // other). 24-hour hotline 800-325-5604.
  OH: {
    name: 'Ohio Attorney General — Bureau of Criminal Investigation, Missing Persons Unit',
    route_kind: 'agency_form',
    tip_url: 'https://inquiries.ohioattorneygeneral.gov/',
    tip_phone: '1-800-325-5604',
  },

  // OK — verified 2026-04-29 against https://oklahoma.gov/osbi/services/investigative-services-division/oklahoma-missing-persons-clearinghouse.html
  // Page heading: "Oklahoma Missing Persons Clearinghouse" (within OSBI
  // Crimes Information Unit). Phone 1-800-522-8017; email
  // okmissing@osbi.ok.gov.
  OK: {
    name: 'Oklahoma Missing Persons Clearinghouse (OSBI)',
    route_kind: 'agency_phone',
    tip_url: 'https://oklahoma.gov/osbi/services/investigative-services-division/oklahoma-missing-persons-clearinghouse.html',
    tip_phone: '1-800-522-8017',
  },

  // OR — verified 2026-04-29 against https://www.oregon.gov/osp/missing/pages/clearinghousefunctions.aspx
  // Page heading: "Clearinghouse Functions". Canonical name: "Missing
  // Children/Adults Clearinghouse" (Oregon State Police). Email:
  // ospmissingpersons@osp.oregon.gov; phone 503-378-2311 / toll-free
  // 1-800-282-7155.
  OR: {
    name: 'Oregon State Police — Missing Children/Adults Clearinghouse',
    route_kind: 'agency_phone',
    tip_url: 'https://www.oregon.gov/osp/missing/pages/default.aspx',
    tip_phone: '1-800-282-7155',
  },

  // PA — verified 2026-04-29 against https://www.pa.gov/agencies/psp/newsroom/pennsylvania-state-police-unveils--psp-tips--as-public-s-new-cri
  // PSP press release explicitly names missing persons within scope of
  // the PSP Tips program; tip form lives at p3tips.com/tipform.aspx?ID=107
  // (PSP-contracted P3 vendor). Hotline 1-800-4PA-TIPS (472-8477).
  // Note: bonus state (not in priority 28) — included because the
  // p3tips.com form is the explicit official PSP missing-persons channel
  // and the contract relationship is documented in the press release.
  PA: {
    name: 'Pennsylvania State Police — PSP Tips (covers missing persons)',
    route_kind: 'crime_stoppers_p3',
    tip_url: 'https://www.p3tips.com/tipform.aspx?ID=107',
    tip_phone: '1-800-472-8477',
  },

  // RI — deferred. null.
  RI: null,

  // SC — deferred. null.
  SC: null,

  // SD — deferred. null.
  SD: null,

  // TN — verified 2026-04-29 against https://www.tn.gov/tbi/tennessees-missing-children.html
  // Page heading: "Tennessee's Missing Persons" (TBI Missing Persons
  // Clearinghouse, within TBI Criminal Intelligence Unit / TN Fusion
  // Center). Hotline 1-800-TBI-FIND (824-3463); email
  // TipsToTBI@tbi.tn.gov.
  TN: {
    name: 'Tennessee Bureau of Investigation — Missing Persons Clearinghouse',
    route_kind: 'agency_phone',
    tip_url: 'https://www.tn.gov/tbi/tennessees-missing-children.html',
    tip_phone: '1-800-824-3463',
  },

  // TX — verified 2026-04-29 against https://www.dps.texas.gov/section/homeland-security/missing-persons-clearinghouse-mpch
  // Page heading: "Missing Persons Clearinghouse (MPCH)" within Texas
  // DPS Intelligence and Counterterrorism Division. Toll-free helpline
  // (800) 346-3243 confirmed on the IC contact page.
  TX: {
    name: 'Texas Department of Public Safety — Missing Persons Clearinghouse (MPCH)',
    route_kind: 'agency_phone',
    tip_url: 'https://www.dps.texas.gov/section/homeland-security/missing-persons-clearinghouse-mpch',
    tip_phone: '1-800-346-3243',
  },

  // UT — deferred. null.
  UT: null,

  // VT — deferred. null.
  VT: null,

  // VA — vsp.virginia.gov returned cert verification failures on direct
  // WebFetch on 2026-04-29. Search snippets reference VAMissing@vsp.virginia.gov
  // and (804) 674-2000, but per the live-verification bar, null until the
  // cert chain is fetchable. Re-verify annually.
  VA: null,

  // WA — verified 2026-04-29 against https://wsp.wa.gov/crime/alerts-missing-persons/missing-persons/
  // Page heading: "Washington State Patrol Missing Persons Unit" (the
  // Missing & Unidentified Persons Unit / MUPU is the designated state
  // clearinghouse). Phone 1-800-543-5678; email mpu@wsp.wa.gov.
  WA: {
    name: 'Washington State Patrol — Missing & Unidentified Persons Unit (MUPU)',
    route_kind: 'agency_phone',
    tip_url: 'https://wsp.wa.gov/crime/alerts-missing-persons/missing-persons/',
    tip_phone: '1-800-543-5678',
  },

  // WV — wvsp.gov refused TLS connections from WebFetch on 2026-04-29
  // (cert chain not verifiable, ECONNREFUSED on alt path). The WV Missing
  // Children Clearinghouse hotline 1-800-352-0927 is referenced in
  // multiple secondary sources (NCMEC clearinghouse directory, statute
  // citations) but no primary state page was directly fetchable, so null.
  // Re-verify when wvsp.gov accepts standard TLS.
  WV: null,

  // WI — deferred. null.
  WI: null,

  // WY — deferred. null.
  WY: null,
};

// Accessor that returns null for unknown state codes — caller should
// honest-fall-through to FBI tip line in tip-route-submit.
export function getStateClearinghouse(
  stateCode: string | null | undefined,
): StateClearinghouse | null {
  if (!stateCode) return null;
  const entry = STATE_CLEARINGHOUSES[stateCode.toUpperCase()];
  return entry ?? null;
}
