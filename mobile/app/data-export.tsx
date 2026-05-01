/**
 * Download my data — privacy-control screen.
 *
 * Surfaces every artifact The Cold File has stored on the user's device and
 * account: saved cases, submitted tips, watch zones. The user taps "Download
 * data", we gather the payload, JSON.stringify it, and hand it to the OS share
 * sheet via React Native's built-in Share API. Delivery is OTA-only — no new
 * native dependencies.
 *
 * The share sheet's `message` field is sized for typical users (<100 saved
 * cases + a handful of tips); larger payloads should still work because RN's
 * Share is just a thin wrapper on UIActivityViewController / Intent.ACTION_SEND.
 *
 * Inline trust-disclosure copy here (rather than <TrustDisclosureCallout/>)
 * because that component is parameterized for the tip-routing flow's agency
 * name. Same visual shape — you.here left edge + InfoText body — to match
 * the rest of the privacy posture surfaces.
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AmberCTA } from '@/components/cf/cta-button';
import {
  InfoText,
  MonoLabel,
  NarrativeText,
  SansBody,
  SerifTitle,
} from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { gatherUserData } from '@/lib/data-export';

type Status = 'idle' | 'gathering' | 'sharing' | 'error';

export default function DataExportScreen() {
  // Hooks before early returns. Always.
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [counts, setCounts] = useState<{
    savedCases: number;
    submittedTips: number;
    watchZones: number;
  } | null>(null);
  const [countsLoading, setCountsLoading] = useState<boolean>(true);

  // Lightweight count preview so the user sees what they're about to export.
  // Re-runs gatherUserData on press for the actual share — counts here are
  // a UX courtesy, not load-bearing.
  useEffect(() => {
    let cancelled = false;
    gatherUserData()
      .then((data) => {
        if (cancelled) return;
        setCounts({
          savedCases: data.savedCases.length,
          submittedTips: data.submittedTips.length,
          watchZones: data.watchZones.length,
        });
        setCountsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setCountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDownload = async () => {
    setStatus('gathering');
    setErrorMessage(null);
    try {
      const data = await gatherUserData();
      const json = JSON.stringify(data, null, 2);
      setStatus('sharing');
      const result = await Share.share({
        message: json,
        title: 'The Cold File — your data',
      });
      // RN Share returns activityType undefined when the user dismisses the
      // sheet on iOS, and action 'dismissedAction' on iOS only. Either way
      // it's a non-fatal no-op — return to idle without an error.
      void result;
      setStatus('idle');
      // Refresh the counts in case the export was preceded by a star-toggle
      // elsewhere in the app (cheap; runs in the background).
      const refreshed = await gatherUserData();
      setCounts({
        savedCases: refreshed.savedCases.length,
        submittedTips: refreshed.submittedTips.length,
        watchZones: refreshed.watchZones.length,
      });
    } catch (e) {
      setStatus('error');
      setErrorMessage(e instanceof Error ? e.message : 'Could not prepare your data.');
    }
  };

  const summaryLine = countsLoading
    ? 'Counting…'
    : counts
    ? `${counts.savedCases} saved ${counts.savedCases === 1 ? 'case' : 'cases'} · ${counts.submittedTips} ${counts.submittedTips === 1 ? 'tip' : 'tips'} · ${counts.watchZones} watch ${counts.watchZones === 1 ? 'zone' : 'zones'}`
    : '—';

  const buttonLoading = status === 'gathering' || status === 'sharing';

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
            Your data
          </SerifTitle>
          <MonoLabel
            size={tokens.size.monoLabel}
            color={tokens.color.text.secondary}
            style={{ marginTop: 2 }}
          >
            EXPORT
          </MonoLabel>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
        <View
          style={{
            marginTop: 8,
            backgroundColor: tokens.color.bg.infoTint,
            borderLeftWidth: 2,
            borderLeftColor: tokens.color.you.here,
            paddingVertical: 10,
            paddingHorizontal: 12,
          }}
        >
          <InfoText>
            Includes your saved cases, submitted tips, and watch zones —
            everything The Cold File has stored on this device. We don&apos;t
            sell or share your data.
          </InfoText>
        </View>

        <NarrativeText style={{ marginTop: 18 }}>
          Tap below to package your data as JSON and hand it to your device&apos;s
          share sheet — save it to Files, email it to yourself, or send it to
          another app. The Cold File never sees the export.
        </NarrativeText>

        <View
          style={{
            marginTop: 20,
            paddingVertical: 12,
            paddingHorizontal: 13,
            backgroundColor: tokens.color.bg.elev1,
            borderColor: tokens.color.border.subtle,
            borderWidth: 0.5,
            borderRadius: 6,
          }}
        >
          <MonoLabel size={tokens.size.monoLabel} color={tokens.color.text.secondary}>
            INCLUDED
          </MonoLabel>
          <SansBody style={{ fontSize: 13, marginTop: 4 }}>
            {summaryLine}
          </SansBody>
        </View>

        {errorMessage ? (
          <SansBody
            style={{
              marginTop: 16,
              color: tokens.color.text.secondary,
              fontSize: tokens.size.meta,
            }}
          >
            {errorMessage}
          </SansBody>
        ) : null}

        <View style={{ marginTop: 28 }}>
          <AmberCTA
            label="Download data"
            onPress={handleDownload}
            loading={buttonLoading}
          />
        </View>
      </ScrollView>
    </View>
  );
}
