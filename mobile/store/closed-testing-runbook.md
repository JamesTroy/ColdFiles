# Closed testing runbook — The Cold File

End-to-end checklist for getting a closed-track build into 12+ testers' hands and starting the 14-day clock the Play Console requires for new personal developer accounts.

---

## 0. Prereqs (one-time)

- [ ] Google Play Console developer account, identity verification complete (~1 week if new since 2025).
- [ ] If account type is **personal**: closed testing 12 × 14 is mandatory. If **organization-verified**: skip the 14-day gate.
- [ ] EAS account configured. `eas login` from the `mobile/` dir.
- [ ] `eas.json` build profile for the `internal` track (preview-style build, signed with the production keystore).
- [ ] Bundle identifier `com.matteblackdev.coldfile` reserved in Play Console (the Create app step).

---

## 1. Build the upload artifact (.aab)

```bash
cd /Users/jtroy/Desktop/ColdFiles/mobile
eas build --platform android --profile production
```

- This produces a signed `.aab`. EAS holds the upload key; Play App Signing holds the app signing key.
- First build prompts for keystore generation — accept "Generate new keystore" and store the EAS-generated credentials.
- Subsequent builds reuse the same keystore automatically.

If `eas.json` doesn't have a `production` profile yet:

```jsonc
// eas.json
{
  "build": {
    "production": {
      "android": {
        "buildType": "app-bundle"
      }
    }
  }
}
```

---

## 2. Upload to Play Console (Closed testing track)

- Play Console → The Cold File → **Testing → Closed testing → Create new release**.
- Track name: `Alpha` (or `LA County beta`).
- Upload the `.aab` from EAS (or use Play Console's "Upload from Build" if you've connected the EAS integration).
- Release notes: keep tight, e.g.:
  > V0.1 closed alpha. Map / list discovery, case details, tip-routing flow, sign-in, watch-zone preview. Photos for 5 LA County cases are placeholder slugs — please don't be surprised if "Carlos Alvarez-Diaz" shows a TODO graphic.

---

## 3. Recruit testers

Need 12+ Android testers active for 14+ consecutive days. Each tester:
- Has an Android device with Google Play.
- Accepts the closed-track opt-in link.
- Installs and opens the app at least once.

Recruitment options (in priority order):

1. **Personal network** — friends, family, anyone who's already shown interest. Low friction. Aim for 8.
2. **Email list / waitlist** — if there's a coldfile.app waitlist, send the opt-in link.
3. **Reddit / r/UnresolvedMysteries / r/TrueCrimePodcasts** — DO NOT post the opt-in link publicly; send DMs to mods first to confirm permitted, or post a "looking for closed beta testers" message and collect emails. Public posting risks Play Console flagging it as soliciting reviews.
4. **Last-mile fillers** — services like *PreApps* or *Beta Family* will recruit testers for ~$3-5 each. Use only if personal network < 8.

Send each tester:
- The Play Console opt-in URL (from Closed testing → Testers tab; "Copy link" button).
- One sentence: "Tap to join, install, and please open the app at least once between now and [date]."
- Reminder at day 7 and day 12.

---

## 4. The 14-day clock — what it actually checks

Play Console requires:
- ≥12 testers opted in.
- App "tested" (installed + opened at least once) on each tester's account.
- 14 consecutive days where this state is true.

If a tester opts out or you drop below 12, **the clock resets**. Add buffer — recruit 15+ to absorb attrition.

Day-by-day status visible at: Play Console → Testing → Closed testing → **Tester eligibility** card (shows a green "X / 12 testers" count and the consecutive-day counter).

---

## 5. After 14 days — apply for production access

- A new card appears: "Your app is eligible for production access".
- Click **Apply for production access**, fill the survey (asks about target audience, monetization plan, content rating).
- Approval is usually 24-72 hours.

Once approved you can submit a production release. The first production review takes 1-7 days.

---

## 6. While the clock runs — things to actually fix

Since you have to wait 14 days anyway, use the time to:

- [ ] Replace TODO_PHOTO_URL slots in `lib/sample-data.ts` with real LASD/FBI/NamUs/Charley photo URLs.
  - **Aujay / Charley Project must be mirrored before the URL goes anywhere user-facing.** Upload the photo to Supabase Storage, paste the public URL into `mirror_url`. The `url` field can hold the Charley page's photo URL for provenance, but `lib/photo-policy.ts` will refuse to render it for user display until `mirror_url` is set — so the photo will silently em-dash if you forget. Same rule applies to any future Doe Network photo. FBI / LASD / NamUs hot-link cleanly; populate just `url` for those.
  - In dev, a `console.warn` fires when the policy trips so you'll see it in Metro before it ships.
- [ ] Publish the Privacy Policy + TOS + Takedown + Account-deletion pages on coldfile.app/legal/* (must match the in-app copy verbatim).
- [ ] Configure the Supabase `delete_my_account` RPC (cascade user-owned rows + drop auth.users entry).
- [ ] Configure Supabase Auth → URL Configuration → add `coldfile://auth-callback` to Redirect URLs.
- [ ] Capture the 6 phone screenshots from the dev client (Pixel 10 Pro XL is fine — Play accepts any 16:9 or 9:16 within size limits).
- [ ] Design the 1024×500 feature graphic. Suggestion: serif "THE COLD FILE" centered, mono caption "DISCOVER · ROUTE · NEVER STORE" below, amber-on-near-black palette matching the in-app aesthetic.
- [ ] Fill the Data Safety form using the table in [play-listing.md](mobile/store/play-listing.md).
- [ ] Run the IARC content rating questionnaire. Expected outcome: Mature 17+.
- [ ] Pre-launch report (auto-generated by Play Console) — review for crashes, accessibility flags, broken UI.

---

## 7. Common rejections and how to avoid them

- **Permissions without rationale**: we have rationale screens in onboarding. Don't strip them.
- **OSM attribution stripped**: the Leaflet WebView's attribution control must remain visible. Don't add CSS that hides `.leaflet-control-attribution`.
- **Privacy policy URL 404s**: deploy `coldfile.app/legal/*` *before* hitting Submit.
- **Account deletion missing**: in-app and web both required. Both wired.
- **Target API**: must be 35+ for new submissions. Expo SDK 54 defaults to 35.
- **Crash rate at submission**: Play's pre-launch report runs automated tests. If our app crashes during boot, fix it before submitting (the MapLibre stubbing made this a known risk path — verify the dev client + production AAB both boot cleanly).

---

## 8. Submission day timeline

| T-30d | Recruit testers, draft assets, deploy legal pages |
| T-21d | Build alpha .aab, upload to closed track, send opt-ins |
| T-14d | Closed testing clock starts (assuming all 12+ testers opted in by today) |
| T-7d  | Mid-clock check — confirm 12+ active, push reminder to laggards |
| T-0d  | Clock done. Apply for production access. Capture pre-launch report. |
| T+1-3d | Production access granted. Submit production release. |
| T+3-10d | Production review. App goes live. |

Realistic launch window from "where we are right now": **3-4 weeks** if nothing slips and the closed-test clock starts cleanly.
