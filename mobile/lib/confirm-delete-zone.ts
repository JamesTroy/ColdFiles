/**
 * Shared "delete this zone?" destructive confirm — used in the Saved tab
 * (zone-row delete from the segmented list) and in the Zone Detail screen
 * (overflow → delete). Two call sites had drifted from "and any matching
 * cases will be removed…" → "will be removed…"; this helper is the merge
 * point so the next divergence can't happen quietly.
 *
 * Alert.alert (modal) is the right primitive here — destructive,
 * irreversible, and the user's confirm is what makes the action safe.
 * Non-destructive transient feedback uses CFToast; this is intentionally
 * NOT a toast.
 *
 * The caller owns post-confirm side effects. `onConfirm` is fired on the
 * destructive button tap; the caller decides whether to await an async
 * remove, surface its own retry UI, or navigate after. Errors are NOT
 * caught here — the failure-UX path varies per screen.
 */

import { Alert } from 'react-native';

import type { WatchZone } from './hooks/use-watch-zones';

export function confirmDeleteZone(zone: WatchZone, onConfirm: () => void): void {
  Alert.alert(
    'Delete this zone?',
    `Your saved area "${zone.label ?? 'Untitled zone'}" will be removed from your zones list. Saved cases are not affected.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onConfirm },
    ],
  );
}
