/**
 * Screen-shell primitives — shared across settings-style screens.
 *
 * Consolidates the byte-identical-with-drift `Card`/`Row` reimplementations
 * that lived inside me.tsx, diagnostics.tsx, notifications.tsx,
 * tip-history.tsx, region-prefs.tsx. Subtle drift (paddingHorizontal 13 vs
 * 14, fontSize 13 vs 13.5 vs 14) was the smoke; this file is the
 * extinguisher.
 *
 * Standardized values:
 *   - Card: marginBottom = tokens.layout.cardGap (12), radius 6, hairline border
 *   - Row: paddingHorizontal 13, paddingVertical 13, label SansBody fontSize 13.5
 *   - NavRow: trailing chevron-forward, never `value="→"`
 *   - Push/Modal headers: 40×40 circle button, MonoLabel eyebrow, h2 serif title
 *
 * No hooks here would surface as a Rules-of-Hooks issue — `useSafeAreaInsets`
 * inside the headers is unconditional and runs on every render.
 *
 * Pure components only — no client-side state, no refs that survive re-render.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ReactElement, ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Mono, MonoLabel, SansBody, SerifTitle } from '@/components/cf/text';
import { tokens } from '@/constants/theme';

/* -------------------------------- Card -------------------------------- */

interface CardProps {
  children: ReactNode;
  /** Override marginBottom or marginHorizontal if needed. Default mb is `tokens.layout.cardGap`. */
  style?: ViewStyle;
}

/**
 * Card — radius-6 elev1 surface with a hairline subtle border. Clips children
 * via `overflow: 'hidden'` so the inner Row top-borders don't bleed past the
 * rounded corners. Default vertical gap is `tokens.layout.cardGap`.
 */
export function Card({ children, style }: CardProps): ReactElement {
  return (
    <View
      style={[
        {
          marginHorizontal: 16,
          marginBottom: tokens.layout.cardGap,
          backgroundColor: tokens.color.bg.elev1,
          borderColor: tokens.color.border.subtle,
          borderWidth: 0.5,
          borderRadius: 6,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/* --------------------------------- Row -------------------------------- */

interface RowProps {
  label: string;
  value: string;
  valueColor?: string;
  valueMono?: boolean;
  onPress?: () => void;
}

/**
 * Row — value row with a label + read-only value, OR pressable navigation
 * where the value carries information ("Signed in: email@example.com",
 * "Subscription: FREE"). For pure-navigation rows (label + chevron only,
 * no information in the value), use NavRow.
 */
export function Row({
  label,
  value,
  valueColor,
  valueMono,
  onPress,
}: RowProps): ReactElement {
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
        gap: 12,
      }}
    >
      <SansBody style={{ fontSize: 13.5 }}>{label}</SansBody>
      {valueMono ? (
        <Mono
          size={13}
          style={{
            color: valueColor ?? tokens.color.text.secondary,
            flexShrink: 1,
            textAlign: 'right',
          }}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {value}
        </Mono>
      ) : (
        <SansBody
          style={{
            color: valueColor ?? tokens.color.text.secondary,
            fontSize: 13,
            flexShrink: 1,
            textAlign: 'right',
          }}
          numberOfLines={1}
        >
          {value}
        </SansBody>
      )}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        {content}
      </Pressable>
    );
  }
  return content;
}

/* ------------------------------- NavRow ------------------------------- */

interface NavRowProps {
  label: string;
  /** Optional secondary hint rendered as small mono caps below the label. */
  hint?: string;
  onPress: () => void;
}

/**
 * NavRow — label + optional secondary hint + trailing chevron-forward.
 *
 * Replaces the `value="→"` pattern from the early me.tsx draft. The
 * stacked arrows read as visual noise; a single Ionicons chevron-forward
 * at the trailing edge is quieter and matches platform conventions.
 */
export function NavRow({ label, hint, onPress }: NavRowProps): ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
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
        <View style={{ flex: 1, minWidth: 0 }}>
          <SansBody style={{ fontSize: 13.5 }}>{label}</SansBody>
          {hint ? (
            <MonoLabel
              size={11}
              color={tokens.color.text.secondary}
              style={{ marginTop: 3 }}
            >
              {hint}
            </MonoLabel>
          ) : null}
        </View>
        <Ionicons
          name="chevron-forward"
          size={16}
          color={tokens.color.text.disabled}
        />
      </View>
    </Pressable>
  );
}

/* ------------------------- CircleButton (shared) ----------------------- */

interface CircleButtonProps {
  children: ReactNode;
  onPress: () => void;
  accessibilityLabel?: string;
}

/**
 * 40x40 circle button — visual reference is the chevron-back / share
 * affordance on case/[slug].tsx. Reused by Push/Modal screen headers so
 * one shape carries every "single-tap action in the chrome row" affordance.
 */
function CircleButton({
  children,
  onPress,
  accessibilityLabel,
}: CircleButtonProps): ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={12}
      style={({ pressed }) => [
        {
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: tokens.color.bg.elev1,
          borderWidth: 0.5,
          borderColor: tokens.color.border.strong,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

/* --------------------------- PushScreenHeader -------------------------- */

interface PushScreenHeaderProps {
  /** Rendered as SerifTitle h2 with explicit fontSize 22 to match existing screens. */
  title: string;
  /** Optional MonoLabel uppercase eyebrow rendered below the title. */
  subtitle?: string;
  /** Defaults to router.back(). */
  onBack?: () => void;
  /** Optional right-side slot — usually a CircleButton (share, etc.). */
  right?: ReactNode;
}

/**
 * PushScreenHeader — chevron-back-circle + center title block + optional
 * right slot. Visual reference: case/[slug].tsx around line 145-170.
 *
 * `useSafeAreaInsets` is the only hook here and is unconditional — runs
 * before any conditional return. Per CLAUDE.md, hooks before early returns.
 */
export function PushScreenHeader({
  title,
  subtitle,
  onBack,
  right,
}: PushScreenHeaderProps): ReactElement {
  const insets = useSafeAreaInsets();
  const handleBack = onBack ?? (() => router.back());
  return (
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
      <CircleButton onPress={handleBack} accessibilityLabel="Back">
        <Ionicons
          name="chevron-back"
          size={18}
          color={tokens.color.text.primary}
        />
      </CircleButton>
      <View style={{ flex: 1 }}>
        <SerifTitle size="h2" style={{ fontSize: 22 }}>
          {title}
        </SerifTitle>
        {subtitle ? (
          <MonoLabel
            size={tokens.size.monoLabel}
            color={tokens.color.text.secondary}
            style={{ marginTop: 4 }}
          >
            {subtitle}
          </MonoLabel>
        ) : null}
      </View>
      {right ?? <View style={{ width: 40 }} />}
    </View>
  );
}

/* --------------------------- ModalScreenHeader ------------------------- */

interface ModalScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Defaults to router.back(). */
  onClose?: () => void;
}

/**
 * ModalScreenHeader — close-X-circle on the right + center title block on
 * the left. Used by sign-in, search, takedown-request modals where "down"
 * is the dismissal direction.
 *
 * Same hook discipline as PushScreenHeader: `useSafeAreaInsets` is the
 * only hook and is unconditional.
 */
export function ModalScreenHeader({
  title,
  subtitle,
  onClose,
}: ModalScreenHeaderProps): ReactElement {
  const insets = useSafeAreaInsets();
  const handleClose = onClose ?? (() => router.back());
  return (
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
      <View style={{ flex: 1 }}>
        <SerifTitle size="h2" style={{ fontSize: 22 }}>
          {title}
        </SerifTitle>
        {subtitle ? (
          <MonoLabel
            size={tokens.size.monoLabel}
            color={tokens.color.text.secondary}
            style={{ marginTop: 4 }}
          >
            {subtitle}
          </MonoLabel>
        ) : null}
      </View>
      <CircleButton onPress={handleClose} accessibilityLabel="Close">
        <Ionicons name="close" size={18} color={tokens.color.text.primary} />
      </CircleButton>
    </View>
  );
}
