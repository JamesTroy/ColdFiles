# UX & Content Audit — pass 2 (post-dd718ec)

Audit run: 2026-04-29 against `/Users/jtroy/Desktop/ColdFiles/mobile`.
Re-runs the same six audits from `04-ux-content.md` after commit `dd718ec`
addressed pass-1 ship-blockers and several OTA items. Walks the first-time
user path: cold launch → onboarding (3 steps) → Map (densified seed:
6 Ventura → 11 cases incl. 5 LA County) → Case detail → Submit-tip flow.

Severity legend: `🔴 SHIP-BLOCKER` (closed-test reviewer flag or visibly broken)
· `🟡 OTA POLISH` (real issue, OTA-pushable) · `🔵 V1.0.1+` (defer) ·
`✅ VERIFIED` (confirms a pass-1 fix landed cleanly).

---

## Verifications (pass-1 fixes)

| Pass-1 # | Finding | Verification | Status |
|---|---|---|---|
| 1 / 24 | Me destructive arrows red → text.secondary | `app/(tabs)/me.tsx:81,87` both pass `tokens.color.text.secondary` | ✅ VERIFIED |
| 2 | Me footer says v1.0.0 | `app/(tabs)/me.tsx:154` reads `THE COLD FILE · v1.0.0` and uses `tokens.color.text.secondary` | ✅ VERIFIED |
| 3 / 36 | List header drops the "WITHIN 25 MI" misclaim | `app/(tabs)/list.tsx:59` reads `${rows.length} CASES · SORTED BY RECENCY` | ✅ VERIFIED (header only — see new finding N1) |
| 4 | Sign-in error color → text.secondary | `app/sign-in.tsx:189–198` uses `tokens.color.text.secondary` | ✅ VERIFIED |
| 5 | Delete-account error color → text.secondary | `app/delete-account.tsx:170–179` uses `tokens.color.text.secondary` | ✅ VERIFIED |
| 14 | Photo caption fallback "CASE FILE" → "ATTRIBUTION PENDING" | `app/case/[slug].tsx:478` | ✅ VERIFIED (with caveat — see N3) |
| 17 | Onboarding step-1 SKIP gating | `app/onboarding.tsx:81–83,138–156` — SKIP hidden when `stepIndex === 0` | ✅ VERIFIED |
| 31 | Onboarding back chevron in chrome row | `app/onboarding.tsx:113–157` — back chevron, dots, SKIP share one row at `minHeight: 32` | ✅ VERIFIED |
| Map error retry | Map wires error+retry | `app/(tabs)/index.tsx:171–176` renders `ErrorState` with `onRetry={refetch}` | ✅ VERIFIED |
| Peek dismiss | PeekSheet exposes onDismiss X | `components/cf/peek-sheet.tsx:73–98` + Map wires `onDismiss={() => setSelectedSlug(null)}` at `index.tsx:220` | ✅ VERIFIED |
| Tip body ital placeholder | Italic-on-empty placeholder | `app/tip/[slug].tsx:263` — `fontStyle: tipBody ? 'normal' : 'italic'` | ✅ VERIFIED |
| Tab haptic onPressIn | `components/cf/tab-bar.tsx:55–62` | ✅ VERIFIED |
| UnsolvedPill conditional on open status | `app/case/[slug].tsx:174` — `c.status === 'open' ? <UnsolvedPill /> : null` | ✅ VERIFIED |

---

## 1. UX Review (general)

### 🔴 SHIP-BLOCKER

**N1. List section label `ALL CASES NEAR YOU` still lies about geography.**
The list-tab *header* was de-lied (#3 fix), but the *section label* in the body
still reads `ALL CASES NEAR YOU` (`app/(tabs)/list.tsx:85`). With the densified
seed shipping 5 LA-County cases at 8–18 mi distances and 6 Ventura cases at
0.6–12.8 mi distances, "near you" is true for a Ventura tester but a lie for
anyone else. This is the half-fix problem: the surface label was cleaned
without sweeping the section labels. Same fix as #3 — drop "NEAR YOU" until
the radius semantics are real, e.g. `MORE CASES`.

### 🟡 OTA POLISH

**N2. Recency dataset is half-densified.** `lib/sample-data.ts:123` ships 11
cases (6 original + 5 LA-County), but `SAMPLE_LAST_CHANGED_DAYS` at
`lib/sample-data.ts:363–370` still maps only the original 6 slugs. The list
tab sorts by `SAMPLE_LAST_CHANGED_DAYS[r.slug] ?? 999`
(`app/(tabs)/list.tsx:36`), so the 5 new cases all collapse to 999 → sorted
to bottom → never appear in `RECENTLY UPDATED` and never get the `FreshDot`
even though their `recency_alpha` says they should (Armstead = 2 days,
Abdelkader = 3, Alvarez = 7). This is a **regression** introduced when the
densification commit added rows to `SAMPLE_CASES_MAP` without updating the
recency map. Visible symptom: a tester scrolling the list sees 4 fresh
Ventura cases, then a wall of identical-looking older cases — the LA cases
that should *also* be fresh are buried.

**N3. Photo caption strip mislabels em-dash placeholders as `PHOTO 01`.**
`buildPhotoCaption` (`app/case/[slug].tsx:468–481`) always prefixes
`PHOTO 01`, even when `effectivePhotoUri(primary)` returns null and the
PhotoFrame draws an em-dash placeholder. For the 5 new LA cases (all have
`primary_photo_url: null`) the caption strip will read e.g.
`PHOTO 01 · LOS ANGELES POLICE DEPARTMENT · 2024` over an em-dash. Two fixes
either acceptable: (a) only render the caption strip when `uri != null`, or
(b) when no photo exists, swap `PHOTO 01` for `NO IMAGE`. The pass-1 fix to
"ATTRIBUTION PENDING" works only when the photo *is* present.

**N4. Photo caption double-interpunct collision.** Same call path. When
`primary?.source_attribution` is null and the fallback hits
`c.primary_agency?.name`, that name already contains a `·` (e.g. "Los Angeles
County Sheriff's Department · Homicide Bureau"). The caption is then
`PHOTO 01 · LOS ANGELES COUNTY SHERIFF'S DEPARTMENT · HOMICIDE BUREAU · 2024`
— four `·` separators, visually busy and breaks the 3-token caption grammar.
Fix: split agency.name on `·` and take the first segment, or emit
`agency.short_name` (`AGENCIES.lasd.short_name === 'LASD'`) when present —
the data already exists.

**N5. Map "UPDATING" toast still anchored at top-center.** `app/(tabs)/index.tsx:185–211`
reuses `top: 12`, no shift to clear the system status bar. Pass-1 #9 — unfixed.

**N6. Onboarding step-3 still missing "no account required" reassurance.**
`app/onboarding.tsx:62–71` body still implies users must continue. Pass-1 #10 — unfixed.

### 🔵 V1.0.1+

**N7.** "Show less ←" (`app/case/[slug].tsx:220`) still uses left-arrow that
visually conflicts with the back-button affordance. Pass-1 #11 — unfixed.

---

## 2. Content Design

### 🔴 SHIP-BLOCKER

None.

### 🟡 OTA POLISH

**N8. Search empty result still uses HTML entities.** `app/search.tsx:113`
still renders `No matches for &quot;{query}&quot;.`. Pass-1 #7 — unfixed.

**N9. Tip-body placeholder still leaks "PFF Bank / David / 1983–85".**
`app/tip/[slug].tsx:255` is verbatim from pass 1. Worse, this string maps
1:1 to the Evans seed case
(`SAMPLE_CASE_FULL_BY_SLUG['david-evans-1985-claremont-ca']`) — name "David",
employer "Pomona First Federal" (PFF), date range 1985 — so the placeholder
reads as a tip *about that case*. A reviewer or paranoid user could read
this as the app prompting users to fabricate tip content about a real victim.
Replace with a clearly fictive setup, e.g. `e.g. "I worked with K. through
Acme Co. in the late 80s. There was a coworker who…"`. Pass-1 #16 — unfixed,
and now actually higher-risk because the densified seed shipped Evans first.

**N10. Eyebrow `ACCOUNT · SUBSCRIPTION · PRIVACY` promises a Privacy section
that does not exist.** `app/(tabs)/me.tsx:65` advertises three settings
families. Account exists (sign-out / delete). Subscription exists (FREE
row). Privacy does not exist as a tappable section, despite both the eyebrow
and `app/privacy.tsx:45` ("Opt out of crash reports: in-app via Me →
Privacy"). Closed-test reviewer reading both surfaces would flag this as
a missing setting. Cheapest fix: drop "PRIVACY" from the eyebrow and the
crash-report sentence from the privacy doc until v1.0.1.

**N11. "Source credits" / "Source attribution" referenced in the Me-tab
file header is not actually surfaced.** `app/(tabs)/me.tsx:7` doc-comment
promises `Source credits · Takedown · About` as Card 3, but the file ships
`About · Privacy · Terms · Takedown` — there's no source-credits row even
though sample-data sources exist (`AGENCIES`, NamUs, Charley). This isn't
visible to users (it's a doc-comment), but it does suggest a deferred row
that never landed. Either remove the doc-line or add the row.

**N12. `NO PASSWORD · MAGIC LINK` mono-cap on sign-in (`app/sign-in.tsx:113`).**
Tester unfamiliar with magic-link UX may miss "magic link" as a UX term and
read it as branding. Consider `NO PASSWORD · ONE-TAP EMAIL LINK` so the
mechanism is plain. Minor.

### 🔵 V1.0.1+

**N13.** Narrative truncation 40-words still hardcoded twice
(`app/case/[slug].tsx:304–313`); `tokens.caseDetail.narrativeWords` still
unused. Pass-1 #15 — unfixed.

**N14.** `victim_race` field is being used as a generic role/circumstance
slot — `lib/sample-data.ts:401` stores `'VP, Pomona First Federal'`,
`:430` stores `'Last seen leaving work'`, `:578` stores `'LASD deputy'`.
The case-detail subtitle then renders `Age 57 · VP, Pomona First Federal`
(`app/case/[slug].tsx:295–301`). The DB column name is wrong for the
content shape; when actual race data flows in (real LASD bulletins include
victim race), the schema collision will be visible to users.

---

## 3. Responsive Design

### 🔴 SHIP-BLOCKER

None.

### 🟡 OTA POLISH

**N15. Still no `useWindowDimensions` adoption.** Confirmed via grep across
`/app` and `/components/cf` — zero matches. Pass-1 #20 sub-items unfixed:
- `components/cf/photo-frame.tsx:65` still hardcodes `height = 200`.
- `app/watch-zone.tsx:254,303` still hardcode `height: 240`.
- `app/(tabs)/saved.tsx:146` still uses `maxWidth: 280`.

### 🔵 V1.0.1+

**N16.** Tab-bar still distributes `flex: 1` per tab — on a Tab S11 Ultra
each tab is ~360dp wide. Pass-1 #21 — unfixed.

---

## 4. Settings & Preferences

### 🔴 SHIP-BLOCKER

None — pass-1 #1/#24 verified above.

### 🟡 OTA POLISH

**N17. Delete-account row still in the same Account card as Sign-in / Sign-out
without visual separation.** `app/(tabs)/me.tsx:69–100` lists
`Signed in / Sign out / Delete account` in one Card. Pass-1 #25 — unfixed.
The arrow-color fix removed the ship-blocker but the visual-grouping
recommendation is still open. Suggested: split Delete-account into its own
Card after the About/legal block.

**N18. Sign-out row arrow still `→` instead of `SIGN OUT` mono.** Pass-1 #26 — unfixed.

**N19. Watch Zone screen still routable** (`/watch-zone` registered in
`app/_layout.tsx:112–117`) with no Me-tab entry point. The screen renders a
Premium-pill UI and a non-interactive map preview. Anyone deep-linking to
`coldfile://watch-zone` (or via `expo-router`'s file-system-based deep links)
sees a fully-styled but broken-in-context screen. Pass-1 #12 — unfixed.
Easiest fix: comment out the Stack registration. The auth-required gate
inside (`WatchZoneSignInGate`) doesn't help — non-auth designer-mode users
go straight into the polygon-edit UI.

**N20. Crash-report opt-out still promised in Privacy with no UI.** Pass-1 #27 — unfixed.

### 🔵 V1.0.1+

**N21.** Card border-radius drift: Me cards use literal `borderRadius: 6`
(`app/(tabs)/me.tsx:171`) but `tokens.radius.card === 8`. Multiple files
(`sign-in.tsx:180`, `search.tsx:88`, `watch-zone.tsx:134,151,257,306`)
hardcode 6 instead of pulling from the token. Sweep before v1.0.1.

**N22.** Footer version is hardcoded as the literal string `v1.0.0` at
`app/(tabs)/me.tsx:154`. Next OTA bump (v1.0.1) ships an AAB with that
version but the footer would still say v1.0.0 unless the OTA payload also
edits this string. Read from `Constants.expoConfig?.version` instead.

---

## 5. Breadcrumb & Wayfinding

### 🔴 SHIP-BLOCKER

None.

### 🟡 OTA POLISH

**N23. Onboarding back chevron is now in-row but visually still inconsistent.**
The pass-1 fix (`app/onboarding.tsx:122–134`) put the chevron in the chrome
row, but it still has no circle background — just a 20px naked icon. Every
other modal/screen back chevron (`app/sign-in.tsx:82–102`, `delete-account.tsx:96–116`,
`search.tsx:54–74`, `watch-zone.tsx:81–101`) uses a 36×36 circle with `bg.elev1`
+ `border.strong`. The onboarding chevron now lives in the same screen-chrome
position, so the asymmetry reads more clearly than it did pre-fix. Either
add the circle wrapper (preferred) or leave both naked and document the
"onboarding is lighter chrome" intent. Currently pass-1 #31 is partially
addressed: layout fixed, visual still divergent.

**N24. Case detail has no sticky breadcrumb** (case number scrolls away with
the photo). Pass-1 #33 — unfixed.

### 🔵 V1.0.1+

**N25.** Search modal loses query state on dismiss. Pass-1 #34 — unfixed.

---

## 6. Table & List Design

### 🔴 SHIP-BLOCKER

None — header "WITHIN 25 MI" claim removed.

### 🟡 OTA POLISH

**N26. List header copy is honest, body section labels still aren't** — see
N1 above (cross-listed; this is the same issue).

**N27. agencyShortName regex falls through for every densified-seed case.**
`app/(tabs)/list.tsx:236–242`: `^[A-Z]{2,5}\b` matches "FBI" but NOT
"Los Angeles County Sheriff's Department · Homicide Bureau",
"Ventura County Sheriff's Office", "Oxnard Police Department",
"Thousand Oaks Police", or "Los Angeles Police Department" — *every* sample
agency except FBI fails the regex and falls through to
`split('·')[0].trim().slice(0, 24)`. Result: cases ≥ 10 days old render
"Los Angeles County Sheri" or "Ventura County Sheriff'" in line 3 of the row.

The data model already has `agencies.short_name` (`lib/sample-data.ts:27,41,55,69,83,97`)
with the correct strings (`'LASD'`, `'Oxnard PD'`, `'VCSO'`, etc.) — but
`primary_agency_name` on the row stores `AGENCIES.x.name`, not `short_name`.
Pass the short_name via the row shape and drop the regex. Pass-1 #19 was
flagged as v1.0.1 with "acceptable for v1," but with the densified seed,
**every non-FBI row over 10 days old now displays a truncated agency name**
to closed-testing testers. Promote to OTA polish.

**N28. List rows have no case-number affordance** (Pass-1 #39, V1.0.1).

### 🔵 V1.0.1+

**N29.** Two-column tablet grid (Pass-1 #40 / #23).
**N30.** Pull-to-refresh on List (Pass-1 #41).
**N31.** Distance/kind/agency sort options (Pass-1 #42).

---

## Regressions introduced by dd718ec

| ID | Regression | Severity |
|---|---|---|
| R1 | List header de-lied but section label `ALL CASES NEAR YOU` not swept (N1) | 🔴 |
| R2 | 5 new densified-seed cases missing from `SAMPLE_LAST_CHANGED_DAYS`, sorted to bottom of list (N2) | 🟡 |
| R3 | "ATTRIBUTION PENDING" caption fix exposes `PHOTO 01 · {LONG_AGENCY_NAME · SUBUNIT} · {YEAR}` collision when `primary_photo_url` is null (N3 / N4) | 🟡 |
| R4 | agencyShortName regex now visibly fails on the densified seed (every non-FBI row, all over 10 days, shows truncated agency name) (N27) | 🟡 |

All four are densification-driven, not arrow/footer-fix-driven. The fixes
themselves landed cleanly; the regressions are caused by the same commit's
data-volume increase outpacing the table/regex/sort scaffolding behind it.

---

## Summary table

| Audit | 🔴 SHIP-BLOCKER | 🟡 OTA POLISH | 🔵 V1.0.1+ | ✅ VERIFIED |
|---|---|---|---|---|
| 1. UX | 1 (N1) | 5 (N2–N6) | 1 (N7) | 5 |
| 2. Content | 0 | 5 (N8–N12) | 2 (N13–N14) | 1 |
| 3. Responsive | 0 | 1 (N15) | 1 (N16) | 0 |
| 4. Settings | 0 | 4 (N17–N20) | 2 (N21–N22) | 4 |
| 5. Wayfinding | 0 | 2 (N23–N24) | 1 (N25) | 1 |
| 6. List | 0 | 2 (N26–N27, +N28 V1.0.1) | 3 (N29–N31) | 0 |
| **Distinct** | **1** | **18** | **9** | **11** |

Distinct ship-blocker: **1** (N1, the section-label half-fix). Distinct OTA
polish: 18 (8 carry-overs + 4 regressions + 6 newly surfaced). Verified
fixes: 11.
