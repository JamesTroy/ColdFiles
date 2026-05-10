/**
 * Delete account — in-app self-service deletion.
 *
 * Required by Play Store policy since 2024: every app with accounts must
 * offer in-app account deletion. This screen invokes a Supabase RPC named
 * `delete_my_account()` (defined in migrations/03_account_deletion_and_retention.sql)
 * which:
 *   - nulls user_id on the user's tip_routings rows (the audit log itself
 *     is retained 12 months for abuse detection per the privacy policy;
 *     only the user-identifying linkage is severed here)
 *   - deletes the auth.users row, cascading user_watches and
 *     user_subscriptions
 *   - returns { ok: true } so we sign the client out
 *
 * The web-accessible counterpart lives at https://coldfile.app/account/delete
 * for users who can't open the app (uninstalled, locked out). That page
 * collects the email + sends a verification link that calls the same RPC.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AmberCTA } from '@/components/cf/cta-button';
import {
  MonoLabel,
  NarrativeText,
  SansBody,
  SerifTitle,
} from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { usePushToken } from '@/lib/hooks/use-push-token';
import { signOut, useUser } from '@/lib/hooks/use-user';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

// Local AsyncStorage keys cleared on account deletion. Saved cases +
// submitted-tip receipts intentionally stay (they're device-local artifacts
// not tied to the account). Notification prefs + push registration ARE
// cleared because they describe a server-side relationship that no longer
// exists post-deletion.
const PUSH_REGISTRATION_KEY = 'cf:push_registration:v1';
const NOTIF_PREFS_KEY = 'cf:notif_prefs:v1';

type Status = 'idle' | 'deleting' | 'error';

export default function DeleteAccountScreen() {
  const insets = useSafeAreaInsets();
  const { user, authAvailable } = useUser();
  const { unregister: unregisterPush } = usePushToken();
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleConfirm = () => {
    Alert.alert(
      'Delete account?',
      'This permanently removes your account, saved cases, and watch zones. We cannot recover them. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void runDelete(),
        },
      ],
    );
  };

  const runDelete = async () => {
    setStatus('deleting');
    setErrorMessage(null);
    try {
      if (!isSupabaseConfigured()) {
        throw new Error(
          'Backend is not configured. Email support@coldfile.app to delete your account.',
        );
      }
      // Clear the local push registration before the RPC. The RPC's
      // auth.users delete cascades the server push_tokens row; we just
      // need to make sure the device doesn't keep the registration id
      // lying around so a future re-install with a new account can
      // start clean.
      await unregisterPush();
      const supabase = getSupabase();
      const { error } = await supabase.rpc('delete_my_account');
      if (error) {
        console.warn('[delete-account] RPC failed');
        throw new Error('rpc');
      }
      // Clear AsyncStorage prefs that describe an account-scoped relationship
      // (push prefs). Saved cases + submitted-tip receipts stay — they're
      // device-local artifacts the user keeps even without an account.
      try {
        await AsyncStorage.multiRemove([PUSH_REGISTRATION_KEY, NOTIF_PREFS_KEY]);
      } catch {
        /* non-fatal — server-side state is the source of truth */
      }
      await signOut();
      router.replace('/');
    } catch (e) {
      console.warn('[delete-account] failed', e instanceof Error ? e.message : String(e));
      setStatus('error');
      setErrorMessage(
        "Couldn't delete your account. Try again, or email support@coldfile.app if it keeps failing.",
      );
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingHorizontal: 16,
          paddingBottom: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityLabel="Back"
          accessibilityRole="button"
          hitSlop={12}
          style={({ pressed }) => [
            {
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: tokens.color.bg.elev1,
              borderWidth: 0.5,
              borderColor: tokens.color.border.strong,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name="chevron-back" size={18} color={tokens.color.text.primary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <SerifTitle size="h2" style={{ fontSize: 20 }}>
            Delete account
          </SerifTitle>
          <MonoLabel
            size={tokens.size.monoLabel}
            color={tokens.color.text.secondary}
            style={{ marginTop: 2 }}
          >
            PERMANENT · CANNOT BE UNDONE
          </MonoLabel>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
        <NarrativeText style={{ marginTop: 8 }}>
          Deleting your account permanently removes:
        </NarrativeText>
        <NarrativeText style={{ marginTop: 12, color: tokens.color.text.secondary }}>
          • Your sign-in email and any session data{'\n'}
          • Saved cases synced to your account (device-local saves stay until you sign out){'\n'}
          • Watch zones and notification preferences{'\n'}
          • Push registrations for this device{'\n'}
          • Your link to any tips you{"'"}ve routed. The audit row (case ID, time, hash) stays up to 12 months for abuse detection, then auto-deletes. Agency-side records remain — agencies own those.
        </NarrativeText>
        <NarrativeText style={{ marginTop: 18 }}>
          We cannot recover deleted accounts. If you want to take a break instead,
          sign out from the Me tab — your account stays put.
        </NarrativeText>

        {!authAvailable ? (
          <SansBody
            style={{
              marginTop: 24,
              color: tokens.color.text.secondary,
              fontSize: tokens.size.meta,
            }}
          >
            You are running in designer mode. There is no account to delete on this
            device. Email support@coldfile.app from a real account to request
            deletion.
          </SansBody>
        ) : !user ? (
          <SansBody
            style={{
              marginTop: 24,
              color: tokens.color.text.secondary,
              fontSize: tokens.size.meta,
            }}
          >
            You are not signed in. Continue with email first, then return here to delete.
          </SansBody>
        ) : (
          <>
            {errorMessage ? (
              <SansBody
                style={{
                  marginTop: 18,
                  color: tokens.color.text.secondary,
                  fontSize: tokens.size.meta,
                }}
              >
                {errorMessage}
              </SansBody>
            ) : null}
            <View style={{ marginTop: 32 }}>
              {status === 'deleting' ? (
                <ActivityIndicator color={tokens.color.accent.amber} />
              ) : (
                <AmberCTA
                  label={`Delete ${user.email ?? 'my account'}`}
                  onPress={handleConfirm}
                />
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
