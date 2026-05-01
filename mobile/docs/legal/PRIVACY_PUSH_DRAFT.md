# Privacy policy — push notifications draft bullet

**Status:** DRAFT — pending legal review before merge into the live policy
(`mobile/app/privacy.tsx`). Do NOT modify the in-app privacy screen from
this draft; the bullet below is the proposed addition only.

## Where this lands

This bullet should be inserted into the existing privacy policy under the
section that enumerates **what we collect** / **how we use it** / **data
retention** — pick the existing section that already covers analogous
device-bound identifiers (e.g. saved-cases AsyncStorage, install id) and
add the bullet there. If no such section exists yet, add it under "Data
we collect" with retention noted inline.

## Proposed bullet

> ### Push notifications
>
> When you turn on notifications, we register a delivery token (provided
> by Apple Push Notification Service or Firebase Cloud Messaging via
> Expo's push relay) so we can send you alerts about cases in your saved
> list, new cases in your watch zones, and tip status updates. We do not
> log notification content. Tokens are deleted when you delete your
> account or revoke notification permission in your device settings. We
> never sell or share tokens.

## Notes for the reviewer

- The token itself is not personally identifying — it's a device-bound
  delivery handle issued by APNs/FCM and routed via Expo. It is not a
  device fingerprint.
- "We do not log notification content" is a hard contract: the
  `notify-fanout` Edge Function writes only delivery counts to logs, never
  notification body text. (See `supabase/functions/notify-fanout/index.ts`.)
- "Tokens are deleted when you delete your account" is enforced by the
  `on delete cascade` on `push_tokens.user_id` (migration 12). Tokens
  registered without auth (install_id only) are pruned by the orphan job
  scheduled for v1.0.2 — surface the retention window once that ships.
- "Revoke in your device settings" is the iOS / Android system-level
  notification permission. The in-app "Disable" button drops the local
  registration but leaves the server row until the orphan job runs;
  consider whether to call this out separately in the policy (proposal:
  no — system-settings revocation is the user's mental model).
