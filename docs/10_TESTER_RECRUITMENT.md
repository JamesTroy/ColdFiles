# 10 — Closed-testing recruitment

Three drafts to clear Google Play's 12-tester / 14-day requirement before
the production push. The shipped client is currently v1.0.2
(versionCode 3); push notifications, map, sign-in, and saved cases are
all working end-to-end on Android.

The Cold File is a niche, mission-aligned product — generic beta-testing
services are the wrong audience because they install once and bounce, and
Google's algorithm increasingly weights real engagement signal. The
right move is to recruit from communities who actually care about the
topic. Two posts (Reddit + Websleuths) plus the Play Console mechanics
to onboard the testers who reply.

**Important:** internal testing testers do NOT count toward the 14-day
gate. Before posting recruitment, you must promote v1.0.2 from
Internal testing → a new Closed Testing track. See the "Play Console
setup" section at the bottom for the one-time setup.

---

## 1. r/UnresolvedMysteries — recruitment post

**Before posting:** check the subreddit's current self-promotion rule
and consider DMing the mod team first. r/UnresolvedMysteries has
historically had a strict no-self-promotion stance with case-by-case
exceptions for tools that genuinely serve the community. A 2-line
heads-up to mods ("solo dev, free, mission-aligned, looking for 12
testers — okay to post?") is the difference between an approved post
and a removed one.

**Suggested title:**

> I built a free Android app that consolidates unsolved cases from public sources and routes tips to the right agency. Looking for 12 testers to clear Google's gate.

**Body:**

```
Hi r/UnresolvedMysteries,

I'm a solo developer (one person, no funding) building **The Cold File** —
a free Android app that pulls publicly-available unsolved homicide,
missing-person, and unidentified-person cases into one map and list. When
you have information, the app deep-links you to the agency that owns the
case so the tip goes where it should. **It never reads or stores your
tip, and there are no ads.**

**Why I'm posting:** Google Play requires 12 testers running the app for
14 days before any new app can be promoted to production. I don't have
the network for that, so I'm asking the community most likely to
actually use a tool like this.

**What testing looks like:**
- Install the app via a Play Store link I'll send you
- Use it occasionally for 14 days (no minimum activity required)
- Feedback welcome but not required — bugs, missing sources, anything

**What the app does today:**
- ~3,100 cases from Doe Network, Charley Project, Project: Cold Case, LASD homicide bureau
- Map + list with case-type / state / date filters
- Per-case detail with photo, key facts, narrative, agency contact
- Tip submission deep-links to the agency's official channel
- Save cases you're following
- Optional push notifications for new cases in watch zones you draw on the map

**What it doesn't do:**
- No ads, no in-app purchases, no premium tier
- No tip logging or content moderation — your tip is yours
- No "guess the killer" gamification, no streaks, no leaderboards
- No third-party tracking beyond what Apple/Google themselves require

**Trust posture:** Photos come from agency releases or family-attributed
sources (Charley Project / Doe Network) under attribution. Sensitive
imagery is hidden behind a tap. Rated 17+. Takedown contact lives in
the app.

**To volunteer:** Comment or DM with the Google account email tied to
your Play Store. I'll send the opt-in link. Android only for now —
iOS will follow after Play production.

Thanks. I'll read everything.
```

**Tone notes:** the audience is allergic to monetization framing. Lead
with what the app *doesn't* do. Mention the takedown contact — that's
specifically what this community looks for in apps in this space.

---

## 2. Websleuths — recruitment post

Forum format, smaller and more invested audience. The "General Mystery
Discussion" or "Identifying The Lost / Doe Network Discussion" sub-board
is probably the right home; verify before posting.

Websleuths members tend to be more direct than Reddit; you can drop
some of the defensive framing.

**Suggested title:**

> Free Android app for unsolved cases — looking for testers (Google Play closed-testing requirement)

**Body:**

```
I'm a solo developer building **The Cold File**, a free Android app
that consolidates unsolved homicide, missing-person, and
unidentified-person cases from public sources (Doe Network, Charley
Project, Project: Cold Case, LASD) into one searchable map and list.
~3,100 cases at last count and growing.

When you submit a tip through the app, it deep-links to the agency
that owns the case — the app never reads or stores tip content. No
middleman, no logging.

**Looking for 12 testers** to install on their Android phones and use
occasionally for 14 days. This is a Google Play Store gate before I
can promote out of closed testing into production. There's no minimum
activity, no quiz, no homework — just install and have it on your
phone for two weeks.

**What it doesn't do:** no ads, no in-app purchases, no premium tier,
no tip logging, no engagement gamification, no third-party tracking
beyond what Google themselves require.

**Why post here:** Websleuths members are exactly the audience this
app is for. If you'd actually use a tool like this, your testing helps
me clear the gate AND the feedback (missing sources, bugs, copy
critiques, anything) goes straight into the next release.

**To join:** PM me with the Google account email linked to your Play
Store, and I'll send the opt-in link. Once accepted, the app installs
from Play normally.

Happy to answer any questions about data sourcing, the takedown
policy, the photo posture, or anything else before you decide.

— [your name / Matte Black Dev]
```

---

## 3. Play Console — onboarding the testers who reply

### One-time setup (DO THIS FIRST, before posting)

The 14-day gate runs on **closed testing**, not internal testing. You
already have v1.0.2 vc3 on the internal track from earlier — promote
it (or upload a fresh copy) to a closed track:

1. Play Console → The Cold File → **Testing → Closed testing**
2. **Create track** → name it `Closed Testing v1` (any name works) → Save
3. On the new track's page, **Releases tab** → **Create new release**
4. Two options for the AAB:
   - **Promote from internal:** in the "App bundles" section there's a
     "Use bundles from another track" link → pick Internal testing →
     pick the v1.0.2 vc3 release → confirm
   - **Or re-upload** `~/Desktop/coldfile-1.0.2-vc3.aab` directly
5. Add release notes (copy from the v1.0.2 internal release if you have
   them, or skip — closed testing release notes show in Play Console only)
6. **Save** → **Review release** → **Start rollout to Closed testing**
7. **Testers tab** on the closed track → **Manage testers**
8. **Create email list** → name it `coldfile-testers` → paste emails
   one per line as you collect them (start with your own to confirm
   it works)
9. Save
10. Scroll to **How testers join your test** → **Copy link** — that's
    your opt-in URL:
    ```
    https://play.google.com/apps/testing/com.matteblackdev.coldfile
    ```
    Same URL as internal testing — Play Store routes by Google
    account membership, not URL.

The 14-day clock starts the moment **12+ active testers** + **an
active release on the closed track** both exist.

### Per-tester DM template

Reuse this for every Reddit/Websleuths reply:

```
Thanks for offering to test The Cold File. Here's the opt-in link:

https://play.google.com/apps/testing/com.matteblackdev.coldfile

Open this on your Android phone — must be the same Google account
you gave me. Tap "Become a tester." After ~5 minutes the app will
be available at that URL or in your Play Store directly. Install it
normally.

No minimum activity required, but please keep it installed for the
full 14 days (Google's rule, not mine). Bug reports and feedback
welcome at support@coldfile.app.

Heads up: rated 17+. Cold-case material — photos from agency
releases and family-attributed sources, sensitive imagery hidden
behind a tap.

Yell if you hit anything weird.
```

### Verifying their opt-in

Play Console → your app → **Testing → Closed testing → Testers**.
Each tester shows up as `Pending` until they've tapped the link and
accepted, then `Active`.

The 14-day clock for Google's promotion eligibility starts the moment
you have **12+ active testers and an active release on the track**.
Both conditions must be true — having 12 testers but no release
doesn't start the clock.

### Sanity checks

- **Account mismatch is the #1 failure mode.** A tester gives you
  one Gmail and tries to install on a phone signed into a different
  Gmail. The opt-in is per-Google-account, not per-device.
- **iOS testers can't help here.** Play closed testing is Android only.
  Note in the recruitment posts that iOS people are welcome on the
  TestFlight wait list once Play promotes (which gates on this).
- **Don't overshoot the tester list.** 12-15 active testers is the
  sweet spot. Adding 30+ creates noise and dilutes the signal Google
  reads.

---

## Backup plays if you're short

If the topic-aligned posts don't fill 12:

1. **r/AppBeta** — generic beta-testing community, ~70k subscribers.
   Reciprocal "I'll test yours if you test mine" is the norm.
2. **Discord servers** — search "Android beta testing" in Disboard.
   Most active ones run reciprocal lists.
3. **Friends + family** — easiest 3-5. They install, the app sits
   on their phone for 14 days, done.

The first play (topic-aligned) is the better signal for Google's
algorithm AND gives you organic reviewers when you eventually go to
production. The backups are pure tester-count fillers.
