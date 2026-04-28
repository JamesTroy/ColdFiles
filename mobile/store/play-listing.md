# Google Play Store listing — The Cold File

Drafted copy + asset checklist for the Play Console submission. Last updated 2026-04-28.

---

## App name
**The Cold File**

(30 char limit; we use 13.)

## Short description (80 chars)
**Discover unsolved cases near you. Route tips to the agencies that own them.**

(78 chars. The verbs anchor purpose: *discover* + *route*. No hype, no exclamation points.)

### Alternates if A/B testing matters
- "Cold cases near you. Tips routed to the right agency, not held by us."
- "Unsolved homicides, missing persons, Doe cases — discover and tip."

---

## Full description (4000 chars max — we use ~1800)

> The Cold File is a discovery and tip-routing app for unsolved cases — homicides, missing persons, and unidentified-person investigations.
>
> Cold cases get cold partly because they fall out of public attention. The Cold File puts them back in front of people who might recognize something — a name, a place, a face — and routes any tip directly to the agency that owns the case.
>
> **HOW IT WORKS**
>
> Browse a map or list of cases near you. Filter by Homicide, Missing, or Unidentified. Tap a case to see the full file: photos, key facts, narrative, and the source agencies the information came from.
>
> If you have information, "Submit a Tip" routes you to the investigating agency's existing tip channel — Crime Stoppers, an agency tip form, or the agency's tip line. The Cold File never reads, holds, or stores tip content. The agency does.
>
> **WHERE THE DATA COMES FROM**
>
> Cases come from public sources: NamUs (Department of Justice), FBI Wanted, agency cold case pages (LASD, LAPD, FDLE, NJSP, OSP, TXDPS), and case-awareness aggregators (The Charley Project, The Doe Network, Project: Cold Case). Every photo and fact is attributed to its source.
>
> **WATCH ZONES (PREMIUM)**
>
> Subscribe to Watch Zones to get push notifications when a new case enters a perimeter you draw, when an existing case inside it is updated, or when a case is identified or solved.
>
> **WHAT WE DO NOT DO**
>
> The Cold File does not investigate cases. We are not affiliated with any law enforcement agency. We do not store or moderate tip content — that responsibility belongs to the agencies that own the cases.
>
> **CONTENT NOTICE**
>
> The Cold File contains depictions of deceased and missing persons, including photos sourced from public agency releases. Sensitive imagery (forensic reconstruction, post-mortem material) is hidden behind a tap. The app is rated 17+.
>
> **PRIVACY**
>
> Your location stays on your device. Tips never pass through our servers. We do not sell data and do not run third-party advertising. Read the full Privacy Policy in the app at Me → Privacy Policy.
>
> **CONTACT & TAKEDOWN**
>
> Family members and rights holders can request photo or case removal at takedown@coldfile.app. General support: support@coldfile.app.

---

## Categorization

- **Category:** News & Magazines (or *Tools* — News & Magazines fits the case-awareness framing better)
- **Tags:** missing persons, cold cases, true crime, public safety, law enforcement
- **Content rating:** Mature 17+ (questionnaire answers cover: graphic violence in some narratives, depictions of deceased persons in some photos, no user-generated content stored, no in-app communication)
- **Target audience:** 18+ (declare in Play Console "Target audience and content" section)

---

## Required URLs

- **Privacy Policy:** `https://coldfile.app/legal/privacy`
- **Terms of Service:** `https://coldfile.app/legal/terms`
- **Account deletion (web):** `https://coldfile.app/account/delete`
- **Support email:** `support@coldfile.app`
- **Marketing URL** (optional): `https://coldfile.app`

> All four URLs must be live before submission. The web property is a separate Next.js codebase; the in-app legal screens at `/about`, `/privacy`, `/terms`, `/takedown` must mirror what's published there.

---

## Asset checklist

### Required (won't submit without these)

- [ ] **App icon** — 512×512 PNG, 32-bit, ≤1024 KB. Adaptive icon already in the build at `assets/images/icon.png`; this is the larger Play Console version.
- [ ] **Feature graphic** — 1024×500 PNG, no alpha. No critical text near edges (gets cropped on some surfaces). Suggested: serif "THE COLD FILE" centered, black-on-amber or amber-on-black, mono caption "DISCOVER · ROUTE · NEVER STORE" below.
- [ ] **Phone screenshots** — minimum 2, max 8. 16:9 or 9:16, min 320 px, max 3840 px on long edge.
  - [ ] 01 Map tab with pins (LA County, real OSM basemap, "ALL · 6" filter active)
  - [ ] 02 Case detail (Maria Thompson — bigger photo, photo frame chrome visible, key facts)
  - [ ] 03 Tip-routing modal (3 routes, RECOMMENDED badge on Crime Stoppers)
  - [ ] 04 Receipt block on case detail post-tip ("✓ ROUTED" amber strip)
  - [ ] 05 Watch Zones (premium, polygon over Ventura)
  - [ ] 06 Saved tab
- [ ] **Short description** (above)
- [ ] **Full description** (above)

### Recommended (visibility cost without)

- [ ] **7-inch tablet screenshots** — same content as phone, tablet aspect.
- [ ] **10-inch tablet screenshots** — same.
- [ ] **Promo video** — YouTube URL only, must be unlisted or public, no pre-roll ads. Skip for v0.1.

### NOT included (auto-flagged since mid-2025)

- ❌ Marketing-style screenshots with heavy text overlays / device frames showing competitor branding / fake award badges. Auto-flagged.
- ❌ "#1 app" or testimonials in the description. Rejected as keyword stuffing / promotional language.

---

## Data Safety form answers (Play Console → App content → Data safety)

| Data type | Collected? | Shared? | Encrypted in transit? | User can request deletion? | Optional/Required? |
|-----------|------------|---------|----------------------|---------------------------|--------------------|
| Approximate location | Yes (only on-device) | No | N/A (not transmitted) | N/A | Optional |
| Precise location | Yes (only on-device) | No | N/A | N/A | Optional |
| Email address | Yes (via Supabase) | No | Yes | Yes | Required (for sign-in) |
| User IDs | Yes (Supabase user ID) | No | Yes | Yes | Required (for sign-in) |
| App interactions | Yes (which cases viewed; for crash debugging) | No | Yes | Yes | Required |
| Crash logs | Yes | No | Yes | Yes | Required |
| Other (tip routing logs) | Yes (case + agency + timestamp + content hash, NOT content) | No | Yes | Yes | Optional |

**Tips data:** Declare honestly that we record *that a tip was submitted* but not *what was said*. This is unusual for the form and may prompt reviewer questions — keep the explanation in the description ready to paste into the review chat.

---

## Content rating (IARC questionnaire highlights)

- **Violence:** "References to violence and crime in factual / journalistic context. No interactive violence, no glorification."
- **Disturbing content:** "Yes — depictions of deceased persons in some photos." (Mature 17+ trigger)
- **Drugs/alcohol:** No
- **Sex/nudity:** No
- **Gambling:** No
- **User communication:** "Tips routed externally; no in-app messaging."

Expected rating: **Mature 17+**.

---

## Permissions disclosure (Play Console)

- `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION`: "Used to filter cases by distance from the user. Location is read on-device only and never transmitted."
- No `ACCESS_BACKGROUND_LOCATION` declared — we only use foreground location on the map screen.
- Notification permission: "Used for Watch Zone alerts (premium subscribers only)."

---

## Closed testing setup (mandatory for new personal Play Console accounts)

If the developer account is **personal** (not organization):
- 12+ testers in closed track for 14+ consecutive days before production access.
- Testers added by email; they accept via opt-in URL.
- Once 12 × 14 days is met, "Apply for production access" button appears.

If the account is **organization-verified**, this gate doesn't apply.

Action: confirm the Play Console account type. If personal, recruit 12 testers (friends, beta-list signups, anyone with an Android device) and start the 14-day clock at least three weeks before intended launch.
