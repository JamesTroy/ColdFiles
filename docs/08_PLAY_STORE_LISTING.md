# Play Store listing — closed testing draft

Drafts of every text artifact the Play Console asks for. Copy-paste into the
Console, edit per your read on framing, then submit. Written to match the
app's actual posture (mirror policy, FBI-as-honest-fallback, no tip content
collection) rather than to broaden audience.

## App name

**The Cold File**

(Already set in `app.config.ts`. The Play Store sometimes flags single-word
generic names; "The Cold File" is distinctive enough to clear the duplicate-
name check.)

## Short description (80 char max)

> Unsolved homicides, missing persons, unidentified cases — mapped.

Length: 66 characters. The 80-char slot is one of the most weight-bearing
ASO surfaces in the listing — every word earns either keyword weight or
brand work. The comma list lands three high-volume search terms
("unsolved homicides", "missing persons", "unidentified"); "mapped" at
the end signals the format without spending characters on "directory"
or "database."

The previous "Cold cases on a map. Tips route to the agency — never to
us." (56) carried the trust posture in this slot, but the trust line is
now the second sentence of the long description (above the
~200-char preview cutoff), and the keyword density wins are larger than
the conversion loss from moving it.

Earlier alternates kept here for posterity:

- "Cold cases on a map. Tips route to the agency — never to us." (56)
- "Unsolved cases, mapped. With one-tap tip routing to the right agency." (69)
- "Map of unsolved missing-persons cases. Tips go straight to the agency." (70)

## Full description (4000 char max)

```
The Cold File is a map-first directory of unsolved cold cases —
homicides, missing persons, and unidentified remains. Tips route to the
investigating agency, never to us. Cases are aggregated from publicly
available federal, state, and local records and shown on a map so you
can see what's near you, or anywhere you choose to look.

What we believe about tips

The most important thing about The Cold File is what we don't do. When you
submit a tip on a case, you leave the app and submit directly to the agency
that owns the case. We never see what you wrote, and your tip never touches
our servers. We log only that a routing happened — case, time, hashed IP,
and a one-way hash of your text — to power the in-app receipt and detect
abuse. None of that reveals what you said.

Where cases come from

The Cold File aggregates publicly available federal, state, and local
public records — currently The Charley Project, The Doe Network, the
FBI's public Wanted bulletin, and the Los Angeles County Sheriff's
Department homicide bureau. The current source list may expand over
time as we add new public-records integrations. Every case in the app
links back to its original source so you can read the full record.

Photos shown in the app come from the same public sources. Photos from
volunteer-funded archives are mirrored on our infrastructure to avoid
burdening their bandwidth. Every photo is attributed to its original
source.

What this app is not

This is not a community, a forum, or a discussion board. There are no
comments, no upvotes, no public profiles. The Cold File is a directory and
a tip-router — nothing more. Speculation about cases belongs on platforms
designed for it, not on case records.

We are not affiliated with any law enforcement agency. Tips you submit
through the app go to the agency's own public infrastructure (state
clearinghouses, P3 / Crime Stoppers, agency forms, or the FBI tip line as
the honest fallback when a state has no public clearinghouse).

Privacy

The Cold File works without an account. If you choose to sign in (to save
cases or, in a future release, to set up watch zones), we ask only for an
email address, used solely to authenticate you. We do not run ads, do not
sell data, and do not have advertising partners.

Approximate location is used briefly when you ask the app to show cases
near you. We do not retain your location, build a movement history, or
correlate location with any identifier.

Takedown

Family members, rights holders, and the agencies that own a case can
request a case, photo, or specific information be removed or corrected.
Email takedown@coldfile.app and we'll respond within 7 days.
```

Length: ~2400 characters. Room to grow if you want to expand the takedown
section or add a "what's coming" footer for v1.0.1 features (LA-area scrapers,
identifying-features schema, watch zones).

## Tagline / promo line (optional, template-dependent)

Some Play Store listing templates surface a one-liner above the
screenshots. If yours does, this slot is editorial-voice-with-no-ASO-
pressure — the brand name is on the install button right next to it,
so this is for *what the app is*, not for keywords.

> A public index of unsolved cases.

Six words. No verb, no claim, no "find" or "track" or "discover" — those
words would push toward true-crime-app register. "Public index" leans
into the editorial-archival posture and matches the Newsreader serif
identity.

If your template doesn't have this slot (most don't), skip it.

## What's new (first release)

Most devs leave the first-release notes generic ("Initial release. Bug
fixes and improvements."). For a sensitive-content app at first launch,
this slot is a tone-setter — the kind of user who reads release notes
is also the kind who reads the privacy policy, and surfacing the data
sources + takedown commitment here is a small move with outsized effect
on that audience's decision to install.

```
First release. Cases sourced from FBI Wanted, the Doe Network, the
Charley Project, and LASD's homicide bureau. If you're connected to a
case and want a record reviewed, every request is read manually within
5 business days — takedown@coldfile.app.
```

Length: 287 characters. Within the 500-char limit Play Console enforces
on the "What's new" field.

## App category

**Primary:** News & Magazines (or possibly Reference). Avoid "Social" and
"Communication" — Play interprets those as having UGC features that trigger
extra review.

## Content rating answers (IARC questionnaire)

The questionnaire is dynamic in the Console. Below are the honest answers per
topic — paste these into the matching IARC questions:

**Violence:**
- Does the app contain violence? **Implied / textual only.** Case narratives
  describe homicide circumstances in text. The app shows no visual depiction
  of violence — photos are family photos, agency portraits, or forensic
  reconstructions (artist renderings, not crime-scene imagery).
- Realistic violence? **No** — narratives reference real cases factually,
  not graphically.

**Sexual / nudity content:**
- All **No.** Some cases involve sexual-violence circumstances which are
  referenced factually in case narratives, but the app contains no sexual
  content, no nudity, no suggestive imagery.

**Profanity:**
- **No.** Narratives are filed prose; case records do not contain profanity.

**Drugs / alcohol / tobacco:**
- **No** for all. Some narratives may reference substance use as case
  context, but the app does not depict or promote use.

**Gambling:**
- **No.**

**User-generated content:**
- **Yes, narrowly.** The tip submission flow includes a free-text field. The
  content of tips never enters our servers — it's hashed locally on the
  device and the user is routed to the agency's own infrastructure. No
  user-generated content is ever displayed to other users in the app.
- Does the app have a moderation system? **Yes** — abuse detection via
  one-way content hashes and hashed IP, retained 12 months and auto-purged.
- Can users interact with each other? **No.**

**Sensitive content (this is the one for cold cases):**
- The app displays photos of missing persons and victims of homicide,
  including (in a future release) forensic reconstructions of unidentified
  remains. Photos are sourced exclusively from public records released by
  investigating agencies, official federal or state aggregators, NCMEC,
  or volunteer case-awareness aggregators.
- The app uses per-photo content gates with reveal-on-tap for any photo
  flagged as sensitive or graphic by the source.
- **Recommended IARC age:** 17+. Match this in the `app.config.ts` and the
  Console's content-rating result.

## Privacy policy URL

> https://coldfile.app/privacy (or wherever you host it)

Must be live before submission. The data-safety form is rejected if the URL
404s during review.

## Reviewer note (App access section)

This text goes into the Play Console "App access" → "All or some functionality
is restricted" → "Instructions for accessing this app" field. It tells the
reviewer how to evaluate sensitive features without misunderstanding them.

```
Test account
============
The app works without sign-in for the core experience (browsing the map,
viewing case details, submitting tips). For testing the account-related
features (saved cases, account deletion):

  Email: reviewer@coldfile.app
  Method: One-tap email link sent to that address. Mailbox is monitored
          during the review period.

What the reviewer will see
==========================
1. The home screen is a map of cold cases (homicides, missing persons,
   and unidentified remains) sourced from publicly available federal,
   state, and local public records. The current production source list
   for v1.0.0 is FBI Wanted, The Charley Project, The Doe Network, and
   the Los Angeles County Sheriff's Department homicide bureau (see
   docs/11_LEGAL_COPY_POLICY.md for the canonical reference). Tapping a
   pin opens a case detail with the victim's name, photo (if released
   by source), and a tip submission CTA.

2. Photos shown in the app are sourced from public records released by
   investigating agencies or by volunteer aggregators. The app does not
   display crime-scene imagery, autopsy photos, or graphic violence. Some
   cases involve forensic reconstructions of unidentified remains; these
   are explicitly labeled "FORENSIC RECONSTRUCTION" and gated behind a
   reveal-on-tap interaction.

3. The "Submit a tip" CTA opens the agency's own tip submission
   infrastructure — a state missing-persons clearinghouse, a Crime
   Stoppers (P3) program contracted by the agency, an agency-hosted form,
   or the FBI tip line as the honest fallback when a state has no public
   clearinghouse. The Cold File never receives, stores, or routes the
   content of tips. We log only a one-way hash of the tip text and a
   hashed IP for abuse detection (12-month retention).

4. Account deletion is fully self-service from the in-app Me → Delete
   account screen. The deletion calls a server RPC that nulls the user's
   tip-routing audit-row links, then deletes the auth user (cascading
   saved cases and watch zones).

What the reviewer should know
=============================
- The Cold File is not affiliated with any law enforcement agency. The
  app routes tips to agencies' existing public infrastructure; it does
  not impersonate or claim to act on behalf of any agency.
- Family members, rights holders, and agencies can request takedown of a
  case, photo, or detail by emailing takedown@coldfile.app. The 7-day
  response commitment is documented in the privacy policy.
- This is closed-testing v1.0.0. Features visibly absent or stubbed:
  watch zones (premium feature, deferred to v1.0.1), an LA-specific
  agency scraper (so most of the seed is national, not metro-dense),
  and per-photo source attribution in the photo-frame caption (the schema
  is being aligned in v1.0.1).
```

## Data Safety form

See the separate walkthrough at `coldfile-data-safety-walkthrough.md`. The
priority-28 routing change does not affect any Data Safety answer — tip
routing was already declared as App Activity → Other actions, and the
state-clearinghouse table is implementation detail invisible to the form.

## Closed-testing tester recruiting message

Paste this when you invite the ≥12 testers (over email or DM). Sets honest
expectations about what the app is, what it isn't, and what you actually
need from them. Closed testing isn't a launch — it's bug-finding.

```
Hi —

I'm opening closed testing on a missing-persons cold-case app called The
Cold File. It's a map of unsolved cases sourced from public records (FBI
Wanted, the Charley Project, the Doe Network, LASD homicide bureau),
with one-tap tip routing direct to the agency that owns each case. The
Cold File never sees the content of tips — they go straight to the
agency's own infrastructure.

I'm looking for ~12 people to install it for two weeks and tell me whether
the install / sign-in / map / tip flow works on a real device. If you have
fifteen minutes and an Android phone, that's the bar — you don't need to
spend hours on it.

What I want to know:
1. Did the app install cleanly?
2. Did the location permission prompt make sense?
3. Did sign-in work (one-tap email link)?
4. If you tapped a pin and "Submit a tip," did the right agency page open?
5. Did anything crash, hang, or look obviously broken?

Honest answers > thoughtful answers. "I tapped this and nothing happened"
is more useful than "the design feels a bit cold." This is build QA, not
product feedback.

To join the closed test:
1. Reply with the Google account email you'll use on the phone.
2. I'll add you to the testers list.
3. You'll get an opt-in link from Play Store within 24h. Tap it, install
   from Play, and you're in.

What you should know going in:
- The app shows photos of missing-persons cases, including (in some cases)
  forensic reconstructions of unidentified remains. Photos are sourced
  from records released by investigating agencies. There's no graphic
  imagery; it's a directory, not a true-crime feed.
- This is v1.0.0. Watch zones, an LA-county-specific case scraper, and
  per-photo source attribution are all v1.0.1 work — features will look
  thin or stubbed in places.
- If you'd rather not test this category of app, that's completely fine —
  just say no thanks.

Thanks,
James
```

Tone choice: leans into the "not a launch, just bug-finding" framing the
user established. Doesn't oversell the product. Names the sensitive-content
caveat early so anyone uncomfortable can opt out without awkwardness.

## Moment the build lands — ordered checklist

When EAS finishes the AAB, do these in order. Most are Console clicks; a
few involve files I can help with.

1. **Download the AAB.** EAS gives you a `.aab` URL. Save it locally.

2. **Create the app in Play Console.** All Apps → Create app → name "The
   Cold File", default language English (US), free, app declarations
   (no, not free trial; yes, app or game? App).

3. **Upload the AAB to Internal testing.** Release → Testing → Internal
   testing → Create new release → upload AAB. Internal testing has zero
   review delay so you can verify the build before opening it to real
   testers.

4. **Install internally + capture screenshots.** Add yourself as an
   internal tester, opt in via the Play link, install on your Pixel.
   Take screenshots: map view, case detail, tip-routed receipt, save +
   Me tab. Need at least 2; 4-6 is the right amount for a polished
   listing. Phone-frame, 9:16 or 16:9 ratio.

5. **Generate the feature graphic** (1024×500). Simple amber-on-near-
   black with the app name in Newsreader, no people, no photos. Quick
   path: Figma frame at 1024×500, paste app name in Newsreader, export
   PNG. Or commission/produce it however you usually handle product art.

6. **Fill the store listing.** Use the short + full description from this
   doc. Upload icon (`mobile/assets/images/icon.png`, will need a 512×512
   variant), feature graphic, screenshots.

7. **Privacy policy URL.** Submission rejects if 404. Drop the policy
   markdown into a Next.js page at `coldfile.app/privacy` (or any HTTPS
   URL — Vercel deploy of a single-page repo works in 2 min).

8. **Content rating questionnaire.** Use the answers in this doc. Submit.

9. **Data Safety form.** Use the walkthrough doc. Submit.

10. **App content section.** Target audience: 17+. Ads: no. Government
    apps: no. News apps: no. Health apps: no. COVID-19 apps: no.

11. **Promote internal → closed testing.** Release → Testing → Closed
    testing → Create track → email list (paste the testers' Google
    account emails). Promote the internal release to this track.

12. **Submit closed testing for review.** Closed testing reviews are
    typically 1-3 days for first-time apps; identity-verified accounts
    sometimes get same-day.

## Pre-submission checklist

- [ ] Privacy policy URL live and matches the policy text exactly
- [ ] Test reviewer mailbox (`reviewer@coldfile.app`) configured + monitored
- [ ] Takedown mailbox (`takedown@coldfile.app`) configured
- [ ] Privacy + security mailboxes (`privacy@`, `security@`) configured
- [ ] All four leaked dev-keys rotated (Supabase service role + anon, Stripe
      sk_test, Mapbox tokens) — see `.env`
- [ ] AAB built signed via EAS, `versionCode: 1`, `versionName: '1.0.0'`
- [ ] App icon (512×512), feature graphic (1024×500), 2+ phone screenshots
- [ ] Content rating questionnaire submitted, target rating: 17+
- [ ] Closed testing track created, tester list (≥12 emails) set
- [ ] Identity verification cleared in Play Console
