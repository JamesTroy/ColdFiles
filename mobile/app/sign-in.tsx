/**
 * Sign-in — email magic-link.
 *
 * Cold File doesn't ask for a password. The user types their email, taps
 * "Send sign-in link", and we hand off to Supabase's `signInWithOtp`. The
 * email arrives with a `coldfile://auth-callback?...` deep link that
 * re-opens the app and finalises the session.
 *
 * In designer mode (no Supabase env), the screen explains that auth needs
 * backend configuration and offers a back action — no broken-state form.
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AmberCTA } from '@/components/cf/cta-button';
import {
  Mono,
  MonoLabel,
  NarrativeText,
  SansBody,
  SerifTitle,
} from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { signInWithEmail } from '@/lib/hooks/use-user';
import { isSupabaseConfigured } from '@/lib/supabase';

type Status = 'idle' | 'sending' | 'sent' | 'error';

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const authAvailable = isSupabaseConfigured();

  const handleSubmit = async () => {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) {
      setStatus('error');
      setErrorMessage("That doesn't look like an email address.");
      return;
    }
    setStatus('sending');
    setErrorMessage(null);
    const { error } = await signInWithEmail(trimmed);
    if (error) {
      setStatus('error');
      setErrorMessage(error.message);
      return;
    }
    setStatus('sent');
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: tokens.color.bg.base }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
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
          <Ionicons name="close" size={20} color={tokens.color.text.primary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <SerifTitle size="h2" style={{ fontSize: 20 }}>
            Continue with email
          </SerifTitle>
          <MonoLabel
            size={tokens.size.monoLabel}
            color={tokens.color.text.secondary}
            style={{ marginTop: 2 }}
          >
            NO PASSWORD · MAGIC LINK
          </MonoLabel>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 16,
          paddingTop: 24,
          paddingBottom: 32,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!authAvailable ? (
          <NarrativeText style={{ color: tokens.color.text.secondary }}>
            Sign-in requires backend configuration. The app is currently running in
            designer mode — your saved cases live on this device only. Configure
            Supabase in mobile/.env to enable accounts.
          </NarrativeText>
        ) : status === 'sent' ? (
          <View>
            <NarrativeText style={{ marginBottom: 12 }}>
              Check your email. We sent a sign-in link to:
            </NarrativeText>
            <Mono
              size={tokens.size.body}
              style={{ color: tokens.color.accent.amber }}
            >
              {email.trim()}
            </Mono>
            <NarrativeText
              style={{ marginTop: 16, color: tokens.color.text.secondary }}
            >
              Open the link on this device and the app will sign you in
              automatically. No password to remember.
            </NarrativeText>
          </View>
        ) : (
          <>
            <NarrativeText style={{ marginBottom: 18 }}>
              Enter your email and we&apos;ll send a one-tap link — no password
              to set or remember. The same link signs you in next time.
            </NarrativeText>

            <MonoLabel
              size={tokens.size.monoChip}
              tracking={tokens.tracking.chip}
              color={tokens.color.text.secondary}
              style={{ marginBottom: 8 }}
            >
              EMAIL
            </MonoLabel>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={tokens.color.text.disabled}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              keyboardType="email-address"
              returnKeyType="send"
              onSubmitEditing={() => void handleSubmit()}
              editable={status !== 'sending'}
              style={{
                backgroundColor: tokens.color.bg.elev1,
                borderColor: tokens.color.border.strong,
                borderWidth: 0.5,
                borderRadius: 6,
                paddingHorizontal: 12,
                paddingVertical: 14,
                color: tokens.color.text.primary,
                fontFamily: tokens.font.sans,
                fontSize: tokens.size.rowName,
              }}
            />

            {errorMessage ? (
              <SansBody
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={{
                  marginTop: 10,
                  color: tokens.color.text.secondary,
                  fontSize: tokens.size.meta,
                }}
              >
                {errorMessage}
              </SansBody>
            ) : null}

            <View style={{ marginTop: 24 }}>
              <AmberCTA
                label="Send link"
                loading={status === 'sending'}
                onPress={handleSubmit}
              />
            </View>

            {/* Notice at Collection per CCPA §1798.100(b) — must
                appear at or before the point of collection. The two
                policy links must be tappable, not plain text, so a
                user can actually read what they're agreeing to. */}
            <NarrativeText
              style={{
                marginTop: 24,
                color: tokens.color.text.secondary,
                fontSize: tokens.size.meta,
              }}
            >
              We collect your email to authenticate you. No marketing. By
              continuing you agree to our{' '}
              <NarrativeText
                style={{
                  color: tokens.color.accent.amber,
                  textDecorationLine: 'underline',
                }}
                onPress={() => router.push('/terms')}
              >
                Terms of Service
              </NarrativeText>
              {' '}and{' '}
              <NarrativeText
                style={{
                  color: tokens.color.accent.amber,
                  textDecorationLine: 'underline',
                }}
                onPress={() => router.push('/privacy')}
              >
                Privacy Policy
              </NarrativeText>
              .
            </NarrativeText>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
