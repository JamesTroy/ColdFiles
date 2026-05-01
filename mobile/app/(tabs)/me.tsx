/**
 * Me tab — profile, subscription, counts, source credits, about.
 *
 * Layout (matches prototype):
 *   - Five cards stacked
 *     0. Account (sign-in / sign-out / delete / diagnostics)
 *     1. Subscription
 *     2. Tips submitted · Cases saved (real counts from useMeCounts) — Cases-saved row is tappable
 *     3. Data · Sources (mix transparency)
 *     4. Help / contact · Notifications · About / legal
 *   - Footer: app version + LLC line in mono evidence-chrome
 *
 * The Premium row routes to /watch-zone (the new screen below).
 */

import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Mono, MonoLabel, SansBody, SerifTitle } from '@/components/cf/text';
import { tokens } from '@/constants/theme';
import { assembleDiagnosticsText } from '@/lib/diagnostics';
import { useMeCounts } from '@/lib/hooks/use-me-counts';
import { useSourceMix, type SourceMixRow } from '@/lib/hooks/use-source-mix';
import { signOut, useUser } from '@/lib/hooks/use-user';

const SUPPORT_EMAIL = 'support@coldfile.app';

interface RowProps {
  label: string;
  value: string;
  valueColor?: string;
  valueMono?: boolean;
  onPress?: () => void;
}

export default function MeScreen() {
  const insets = useSafeAreaInsets();
  const counts = useMeCounts();
  const { user, authAvailable } = useUser();
  const sourceMix = useSourceMix();

  const handleSignOut = () => {
    Alert.alert(
      'Sign out?',
      'Saved cases on this device stay where they are. Watch zones and synced data go away until you sign back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            await signOut();
          },
        },
      ],
    );
  };

  const handleSupportEmail = async () => {
    const subject = 'The Cold File — Support request';
    const body = `\n\n— diagnostics —\n${assembleDiagnosticsText()}\n`;
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Email unavailable', `Reach us at ${SUPPORT_EMAIL}.`);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg.base }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 32 }}>
        <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
          <SerifTitle size="h2" style={{ fontSize: 22 }}>
            Me
          </SerifTitle>
          <MonoLabel
            size={tokens.size.monoLabel}
            color={tokens.color.text.secondary}
            style={{ marginTop: 4 }}
          >
            ACCOUNT · SUBSCRIPTION · PRIVACY
          </MonoLabel>
        </View>

        {/* Card 0 — Account */}
        <Card>
          {user ? (
            <>
              <Row
                label="Signed in"
                value={user.email ?? '—'}
                valueColor={tokens.color.text.secondary}
              />
              <Row
                label="Download my data"
                value="→"
                valueColor={tokens.color.text.secondary}
                onPress={() => router.push('/data-export')}
              />
              <Row
                label="Diagnostics"
                value="→"
                valueColor={tokens.color.text.secondary}
                onPress={() => router.push('/diagnostics')}
              />
              <Row
                label="Sign out"
                value="→"
                valueColor={tokens.color.text.secondary}
                onPress={handleSignOut}
              />
              <Row
                label="Delete account"
                value="→"
                valueColor={tokens.color.text.secondary}
                onPress={() => router.push('/delete-account')}
              />
            </>
          ) : (
            <>
              <Row
                label={authAvailable ? 'Continue with email' : 'Continue with email (designer mode)'}
                value="→"
                valueColor={tokens.color.accent.amber}
                valueMono
                onPress={() => router.push('/sign-in')}
              />
              <Row
                label="Download my data"
                value="→"
                valueColor={tokens.color.text.secondary}
                onPress={() => router.push('/data-export')}
              />
              <Row
                label="Diagnostics"
                value="→"
                valueColor={tokens.color.text.secondary}
                onPress={() => router.push('/diagnostics')}
              />
            </>
          )}
        </Card>

        {/* Card 1 — Subscription */}
        <Card>
          <Row label="Subscription" value="FREE" valueMono />
          {/* Watch zones row deferred to v1.0.1 — drawing UI is not interactive
              yet, so the entry point would promise something we don't ship. */}
        </Card>

        {/* Card 2 — User counts */}
        <Card>
          <Row
            label="Tips submitted"
            value={String(counts.submittedTips)}
            valueMono
            onPress={() => router.push('/tip-history')}
          />
          <Row
            label="Cases saved"
            value="→"
            valueColor={tokens.color.text.secondary}
            onPress={() => router.push('/(tabs)/saved')}
          />
        </Card>

        {/* Card 3 — Data · Sources (mix transparency) */}
        <Card>
          <View
            style={{
              paddingHorizontal: 13,
              paddingVertical: 11,
              borderTopWidth: 0,
            }}
          >
            <MonoLabel size={tokens.size.monoLabel} color={tokens.color.text.secondary}>
              DATA · SOURCES
            </MonoLabel>
            <SansBody style={{ fontSize: 13, color: tokens.color.text.secondary, marginTop: 4 }}>
              {sourceMixSummary(sourceMix)}
            </SansBody>
          </View>
          {sourceMix.loading ? (
            <Row label="—" value="—" valueMono />
          ) : sourceMix.error ? (
            <Row
              label="Couldn't load sources"
              value="—"
              valueColor={tokens.color.text.secondary}
            />
          ) : sourceMix.bySource.length === 0 ? (
            <Row
              label="No sources yet"
              value="—"
              valueColor={tokens.color.text.secondary}
            />
          ) : (
            sourceMix.bySource.map((row) => (
              <SourceRow key={row.slug} row={row} />
            ))
          )}
        </Card>

        {/* Card 4 — Help / Notifications / About */}
        <Card>
          <Row
            label="Help / contact"
            value="→"
            onPress={handleSupportEmail}
          />
          <Row
            label="Notifications"
            value="→"
            onPress={() => router.push('/notifications')}
          />
          <Row
            label="Pinned regions"
            value="→"
            onPress={() => router.push('/region-prefs')}
          />
          <Row
            label="About · mission"
            value="→"
            onPress={() => router.push('/about')}
          />
          <Row
            label="Privacy policy"
            value="→"
            onPress={() => router.push('/privacy')}
          />
          <Row
            label="Terms of service"
            value="→"
            onPress={() => router.push('/terms')}
          />
          <Row
            label="Takedown request"
            value="→"
            onPress={() => router.push('/takedown')}
          />
        </Card>

        {/* Footer */}
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <MonoLabel
            size={tokens.size.monoLabel}
            color={tokens.color.text.secondary}
            style={{ lineHeight: 18 }}
          >
            THE COLD FILE · v1.0.0{'\n'}MATTE BLACK DEV LLC · VENTURA, CA
          </MonoLabel>
        </View>
      </ScrollView>
    </View>
  );
}

function sourceMixSummary(mix: ReturnType<typeof useSourceMix>): string {
  if (mix.loading) return 'Loading…';
  if (mix.error) return '—';
  return `${mix.total.toLocaleString()} cases · ${mix.bySource.length} ${mix.bySource.length === 1 ? 'source' : 'sources'}`;
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

function Row({ label, value, valueColor, valueMono, onPress }: RowProps) {
  const content = (
    <View
      style={{
        paddingHorizontal: 13,
        paddingVertical: 13,
        borderTopWidth: 0.5,
        borderTopColor: tokens.color.border.subtle,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <SansBody style={{ fontSize: 13.5 }}>{label}</SansBody>
      {valueMono ? (
        <Mono
          size={13}
          style={{ color: valueColor ?? tokens.color.text.secondary }}
        >
          {value}
        </Mono>
      ) : (
        <SansBody
          style={{ color: valueColor ?? tokens.color.text.secondary, fontSize: 13 }}
        >
          {value}
        </SansBody>
      )}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
        {content}
      </Pressable>
    );
  }
  return content;
}

function SourceRow({ row }: { row: SourceMixRow }) {
  return (
    <View
      style={{
        paddingHorizontal: 13,
        paddingVertical: 11,
        borderTopWidth: 0.5,
        borderTopColor: tokens.color.border.subtle,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <SansBody style={{ fontSize: 13.5, flex: 1 }} numberOfLines={1}>
        {row.name}
      </SansBody>
      <Mono size={12} style={{ color: tokens.color.text.secondary }}>
        {row.count.toLocaleString()}
      </Mono>
    </View>
  );
}
