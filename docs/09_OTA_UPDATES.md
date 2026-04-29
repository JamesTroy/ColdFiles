# OTA updates

EAS Update is wired. JS-only fixes go out without burning a build credit.
Native or runtime-contract changes still require a full AAB. This doc is
the contract between the two.

## What's wired

- `expo-updates@~29.0.17` is in `mobile/dependencies`.
- `app.config.ts` declares:
  - `updates.url` → `https://u.expo.dev/{eas-project-id}`
  - `runtimeVersion.policy` → `'appVersion'`
- `eas.json` `production.channel` → `"production"`. The matching branch
  was created automatically on the first build (`Created update channel
  "production" and branch "production"` in the build log).
- npm scripts in `mobile/package.json`:
  - `npm run update:production`
  - `npm run update:preview`

By default the client checks for an OTA update on every cold launch and
applies it on the next launch. No code changes needed for that to work.

## Pushing an update

From `mobile/`:

```
npm run update:production -- --message "Fix tip CTA label on Doe cases"
```

(or `eas update --branch production --message "..."` directly)

That bundles the current JS, uploads it to EAS, and clients on
`branch=production` with matching `runtimeVersion=1.0.0` get it on next
launch. Takes ~30 seconds.

The `--message` is what shows up in the EAS dashboard timeline. Be
specific enough that future-you can tell two updates apart at a glance.

## When OTA reaches a client and when it doesn't

`runtimeVersion` is the gate. With `policy: 'appVersion'`, the runtime
version is whatever `version` is in `app.config.ts` at the time the AAB
was built.

| Client app version | Update published for runtimeVersion | Reaches? |
|---|---|---|
| 1.0.0 | 1.0.0 | yes |
| 1.0.0 | 1.0.1 | no |
| 1.0.1 | 1.0.0 | no |

Bumping `version` in `app.config.ts` therefore cuts the OTA channel for
the previous version. That is the safe contract: it forces a fresh native
build whenever a JS change might assume something the old native code
doesn't have.

## When you need a new build vs when OTA suffices

**OTA is fine for:**

- React component changes — copy, layout, styling, logic
- Pure-JS bug fixes
- Asset swaps that don't change the manifest (image replacements that
  reuse the same path; new fonts via `@expo-google-fonts/*` only if the
  font module is already a dependency)
- Adding non-native dependencies (lodash, date-fns, anything pure-JS)

**You need a new AAB build for:**

- Any new native module (every `expo-*` install except those that are
  pure-JS — `expo-constants`, `expo-linking`. Most others have native
  pieces.)
- Any change to `app.config.ts` that affects the manifest:
  permissions, plugins, deep-link scheme, splash, icons, intent filters
- Bumping `version` (because runtimeVersion uses appVersion policy)
- Bumping `versionCode`
- Bumping any `expo-*` SDK package (touches native)
- React Native version changes
- Adding or changing config plugins

If you're unsure: check the [Expo docs page on the package you
changed](https://docs.expo.dev/) — if it has a "Configuration in
app.json/app.config.js" section, the change is native.

## Common scenarios

**Tester finds a typo in case-detail copy:**
1. Edit the string in `mobile/app/case/[slug].tsx`
2. `npm run update:production -- --message "Fix typo on case detail"`
3. Closed testers get it on next launch. No new AAB.

**Tester finds the share button doesn't open the share sheet on a Pixel
8:**
1. Investigate. If it's a JS bug (e.g. wrong import) → OTA fix.
2. If it's a native problem (e.g. permissions, missing intent filter) →
   new AAB. Bump `versionCode`, build, upload.

**You want to change the privacy policy URL:**
1. Edit the policy text. The URL in the privacy policy is unrelated to
   any native config — it's just rendered text in the app.
2. OTA push.

**You want to add a new tab to the bottom navigation:**
1. Edit `mobile/app/(tabs)/_layout.tsx` and add the new tab screen file.
2. OTA push (Expo Router's tab config is JS-side).

**You want to ship the watch-zone polygon UI for v1.0.1:**
1. That involves new native code (Mapbox / MapLibre) and re-enabling the
   plugin.
2. New AAB. Bump `version` to `1.0.1` and `versionCode` to `2`.

## Rollback

OTA updates are versioned. To roll back:

```
eas update:list --branch production
eas update:republish --branch production --group <group-id-of-good-update>
```

`update:republish` re-publishes a prior bundle as the latest update on
the branch. Clients pull it on next launch like any other update. There
is no concept of "uninstall this update" — you republish a known-good
version, which clients then apply.

## Closed-testing-specific posture

For closed testing v1.0, the safe pattern is:

1. **First AAB upload is the floor.** Don't OTA-push anything that
   contradicts the trust posture in the listing copy or privacy policy
   without a fresh AAB and listing review.
2. **OTA freely for visible bugs.** Tester finds a layout bug, a wrong
   string, a CTA that points at the wrong agency name (vs. the wrong
   agency URL — the URL is in code via state-routes.ts, fixable via
   OTA) — push the fix, log it in the EAS dashboard timeline.
3. **New AAB for anything that touches the native side.** When in
   doubt, build. Build credits on Starter are 30/mo and you'll burn
   one update credit (which is unlimited on Starter) per OTA push, so
   the bias should be: prefer OTA, escalate to AAB only when the change
   actually requires it.

## What to verify before each OTA push

- [ ] `npm run typecheck` passes
- [ ] You actually tested the change locally (`npm run start` in mobile/,
      open in Expo Go on your dev device)
- [ ] The change is JS-only — no `app.config.ts` edits, no new
      native packages
- [ ] The `--message` string is specific enough to identify the update
      a year from now without context
