/**
 * Tip-history screen — list of every tip the user has submitted on this device.
 *
 * Source of truth is the device-local AsyncStorage receipt store
 * (`cf:submitted_tips:v1`), surfaced via useTipHistory. Tap a row to open the
 * case-detail screen (same destination as /tip/[slug] flows back to). Empty
 * state is the common case for new users; the loading state shows three
 * skeleton rows so the screen never flickers blank on cold launch.
 *
 * Status field caveat: every row reads 'pending' until the agency-
 * acknowledgment Edge Function ships (see use-tip-history.ts header). The
 * pill colors + labels are wired so flipping the status value is the only
 * change needed when that lands.
 *
 * Per CLAUDE.md: hooks before any conditional return.
 */

import { router, Stack } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Mono,
  MonoLabel,
  SansBody,
  SansMedium,
  SerifTitle,
} from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { formatDateMonthDay } from '@/lib/format';
import {
  useTipHistory,
  type TipHistoryRow,
  type TipStatus,
} from '@/lib/hooks/use-tip-history';

export default function TipHistoryScreen() {
  const insets = useSafeAreaInsets();
  const { tips, loading, error } = useTipHistory();

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 32 }}>
        <View
          style={{
            paddingHorizontal: 16,
            paddingBottom: 16,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View style={{ flex: 1 }}>
            <SerifTitle size="h2" style={{ fontSize: 22 }}>
              Tip history
            </SerifTitle>
            <MonoLabel
              size={tokens.size.monoLabel}
              color={tokens.color.text.secondary}
              style={{ marginTop: 4 }}
            >
              SUBMITTED
            </MonoLabel>
          </View>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingHorizontal: 4 })}
          >
            <SansBody style={{ color: tokens.color.text.secondary, fontSize: 13 }}>
              Close
            </SansBody>
          </Pressable>
        </View>

        {loading ? (
          <Card>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </Card>
        ) : error ? (
          <Card>
            <View style={{ paddingHorizontal: 13, paddingVertical: 18 }}>
              <SansBody style={{ color: tokens.color.text.secondary, fontSize: 13 }}>
                {error}
              </SansBody>
            </View>
          </Card>
        ) : tips.length === 0 ? (
          <EmptyState />
        ) : (
          <Card>
            {tips.map((tip, idx) => (
              <TipRow key={`${tip.caseSlug}:${tip.submittedAt}`} tip={tip} isFirst={idx === 0} />
            ))}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

function EmptyState() {
  return (
    <View style={{ paddingHorizontal: 24, paddingTop: 56, alignItems: 'center' }}>
      <SerifTitle size="h2" style={{ fontSize: 18, textAlign: 'center' }}>
        You haven&apos;t submitted any tips yet.
      </SerifTitle>
      <MonoLabel
        size={tokens.size.monoLabel}
        color={tokens.color.text.secondary}
        style={{ marginTop: 12, textAlign: 'center' }}
      >
        TAP A CASE → SUBMIT A TIP TO GET STARTED.
      </MonoLabel>
    </View>
  );
}

function TipRow({ tip, isFirst }: { tip: TipHistoryRow; isFirst: boolean }) {
  return (
    <Pressable
      onPress={() => router.push(`/tip/${tip.caseSlug}`)}
      style={({ pressed }) => ({
        paddingHorizontal: 13,
        paddingVertical: 13,
        borderTopWidth: isFirst ? 0 : 0.5,
        borderTopColor: tokens.color.border.subtle,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <SansMedium size={tokens.size.body} numberOfLines={1}>
          {tip.caseName}
        </SansMedium>
        <Mono
          size={tokens.size.meta}
          style={{ color: tokens.color.text.secondary, marginTop: 3 }}
          numberOfLines={1}
        >
          {tip.agencyName}
        </Mono>
        <Mono
          size={tokens.size.monoLabel}
          style={{ color: tokens.color.text.disabled, marginTop: 4 }}
        >
          {formatDateMonthDay(tip.submittedAt)}
        </Mono>
      </View>
      <StatusPill status={tip.status} />
    </Pressable>
  );
}

function StatusPill({ status }: { status: TipStatus }) {
  const { label, color } = pillStyle(status);
  return (
    <View
      style={{
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: tokens.radius.pill,
        backgroundColor: tokens.color.bg.elev2,
      }}
    >
      <MonoLabel
        size={tokens.size.monoChip}
        tracking={tokens.tracking.chip}
        color={color}
      >
        {label}
      </MonoLabel>
    </View>
  );
}

function pillStyle(status: TipStatus): { label: string; color: string } {
  if (status === 'acknowledged') {
    return { label: 'ACKNOWLEDGED', color: tokens.color.accent.amber };
  }
  if (status === 'closed') {
    return { label: 'CLOSED', color: tokens.color.text.secondary };
  }
  return { label: 'PENDING', color: tokens.color.text.disabled };
}

function SkeletonRow() {
  return (
    <View
      style={{
        paddingHorizontal: 13,
        paddingVertical: 13,
        borderTopWidth: 0.5,
        borderTopColor: tokens.color.border.subtle,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <View style={{ flex: 1, gap: 6 }}>
        <View
          style={{
            height: 14,
            width: '55%',
            backgroundColor: tokens.color.bg.elev2,
            borderRadius: 3,
          }}
        />
        <View
          style={{
            height: 11,
            width: '40%',
            backgroundColor: tokens.color.bg.elev2,
            borderRadius: 3,
          }}
        />
        <View
          style={{
            height: 9,
            width: '30%',
            backgroundColor: tokens.color.bg.elev2,
            borderRadius: 3,
          }}
        />
      </View>
      <View
        style={{
          height: 18,
          width: 72,
          backgroundColor: tokens.color.bg.elev2,
          borderRadius: tokens.radius.pill,
        }}
      />
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        marginHorizontal: 16,
        marginBottom: 12,
        backgroundColor: tokens.color.bg.elev1,
        borderColor: tokens.color.border.subtle,
        borderWidth: 0.5,
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}
