/**
 * CFToast — transient feedback primitive for non-destructive cases.
 *
 * The app uses Alert.alert for everything, which is wrong for retryable
 * network errors, validation messages, and success acks: a modal that
 * steals focus + needs a tap to dismiss is too heavy for the "we
 * noticed, here's a status, keep going" register. Toasts cover that
 * gap. Destructive confirmations (delete account, takedown, anything
 * irreversible) STAY as Alert — the modal weight is the point there.
 *
 * Shape:
 *
 *   - <CFToastProvider> mounts once in _layout.tsx inside ThemeProvider
 *     so it shares theme + sits outside <Stack> so it overlays every
 *     route. Holds the queue + the visible toast in state.
 *   - showToast({ kind, message, ... }) is a module-level imperative
 *     function. Existing call sites are already inside async try/catch
 *     handlers; forcing them to use a hook would refactor every
 *     consumer. The provider registers a setter on mount; showToast
 *     pushes into that setter via a module-level ref.
 *
 * Queue: single visible at a time, FIFO. Cap of 3 — beyond that we
 * drop OLDEST (not incoming). The intuition: if four errors land
 * back-to-back, the first one is stale by the time the user reads it;
 * the latest message is the actionable one. Capping by dropping the
 * head also bounds memory when something pathological hammers the
 * setter in a tight loop.
 *
 * Placement: top, below the safe-area inset. Bottom placement would
 * collide with the 96px peek sheet + the FAB stack on /map (see the
 * `feedback_map_fab_clears_bottom_sheet_peek` memory). Top is also
 * the right semantic — toasts are status, not navigation.
 *
 * Hooks rule: every hook in this file is declared before any
 * conditional return. The bug this prevents is the Android Fabric
 * blank-grey-screen mode that doesn't reproduce in dev. See
 * CLAUDE.md "Hooks before early returns."
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tokens } from '@/constants/theme';

import { Mono, MonoLabel, SansBody } from './text';

export type CFToastKind = 'error' | 'success' | 'info';

export interface CFToastOptions {
  kind: CFToastKind;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Override default duration. Defaults: error 4000ms, success/info 3000ms. */
  durationMs?: number;
}

interface QueuedToast extends CFToastOptions {
  id: number;
}

const QUEUE_CAP = 3;
const FADE_IN_MS = 200;
const FADE_OUT_MS = 150;
const SLIDE_PX = 8;

// Module-level enqueue ref. The provider registers its setter on mount
// and clears it on unmount. showToast() reads through this ref so calls
// before the provider mounts no-op silently rather than crash — the
// alternative (throw) would surface as an unhandled rejection from any
// auth/network bootstrap that fires a toast in its first tick.
let enqueueRef: ((t: CFToastOptions) => void) | null = null;
let nextId = 1;

export function showToast(options: CFToastOptions): void {
  if (!enqueueRef) return;
  enqueueRef(options);
}

function labelFor(kind: CFToastKind): string {
  if (kind === 'error') return 'ERROR';
  if (kind === 'success') return 'DONE';
  return 'NOTE';
}

function accentFor(kind: CFToastKind): string {
  if (kind === 'error') return tokens.color.accent.amber;
  if (kind === 'success') return tokens.color.status.resolved;
  return tokens.color.you.here;
}

function defaultDurationFor(kind: CFToastKind): number {
  return kind === 'error' ? 4000 : 3000;
}

export function CFToastProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<QueuedToast[]>([]);

  useEffect(() => {
    enqueueRef = (options) => {
      setQueue((prev) => {
        const next = [...prev, { ...options, id: nextId++ }];
        // Drop oldest when over cap — see file header for the rationale.
        return next.length > QUEUE_CAP ? next.slice(next.length - QUEUE_CAP) : next;
      });
    };
    return () => {
      enqueueRef = null;
    };
  }, []);

  const current = queue[0] ?? null;

  const dismiss = useMemo(
    () => (id: number) => {
      setQueue((prev) => (prev[0]?.id === id ? prev.slice(1) : prev));
    },
    [],
  );

  return (
    <>
      {children}
      {current ? <ToastCard key={current.id} toast={current} onDismiss={() => dismiss(current.id)} /> : null}
    </>
  );
}

function ToastCard({ toast, onDismiss }: { toast: QueuedToast; onDismiss: () => void }) {
  const insets = useSafeAreaInsets();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(-SLIDE_PX);
  const dismissedRef = useRef(false);

  const duration = toast.durationMs ?? defaultDurationFor(toast.kind);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: FADE_IN_MS, easing: Easing.out(Easing.quad) });
    translateY.value = withTiming(0, { duration: FADE_IN_MS, easing: Easing.out(Easing.quad) });
  }, [opacity, translateY]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (dismissedRef.current) return;
      dismissedRef.current = true;
      opacity.value = withTiming(0, { duration: FADE_OUT_MS, easing: Easing.in(Easing.quad) });
      translateY.value = withTiming(-SLIDE_PX, { duration: FADE_OUT_MS, easing: Easing.in(Easing.quad) });
      setTimeout(onDismiss, FADE_OUT_MS);
    }, duration);
    return () => clearTimeout(t);
  }, [duration, onDismiss, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const triggerDismiss = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    opacity.value = withTiming(0, { duration: FADE_OUT_MS, easing: Easing.in(Easing.quad) });
    translateY.value = withTiming(-SLIDE_PX, { duration: FADE_OUT_MS, easing: Easing.in(Easing.quad) });
    setTimeout(onDismiss, FADE_OUT_MS);
  };

  const handleAction = () => {
    toast.onAction?.();
    triggerDismiss();
  };

  const accent = accentFor(toast.kind);
  const label = labelFor(toast.kind);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        {
          position: 'absolute',
          top: insets.top + 4,
          left: 12,
          right: 12,
          zIndex: 1000,
        },
        animatedStyle,
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${label}. ${toast.message}`}
    >
      <Pressable
        onPress={triggerDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss notification"
        style={{
          backgroundColor: tokens.color.bg.amberTintCard,
          borderColor: tokens.color.evidence.chrome,
          borderWidth: 0.5,
          borderLeftColor: accent,
          borderLeftWidth: 2,
          borderRadius: 6,
          paddingVertical: 10,
          paddingHorizontal: 12,
          gap: 6,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <MonoLabel
            size={tokens.size.monoLabel}
            tracking={tokens.tracking.label}
            color={accent}
          >
            {label}
          </MonoLabel>
          <SansBody
            style={{
              color: tokens.color.text.primary,
              fontSize: tokens.size.meta,
              lineHeight: tokens.size.meta * 1.4,
            }}
          >
            {toast.message}
          </SansBody>
        </View>
        {toast.actionLabel ? (
          <Pressable
            onPress={handleAction}
            accessibilityRole="button"
            accessibilityLabel={toast.actionLabel}
            hitSlop={8}
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, marginLeft: 12 }]}
          >
            <Mono
              size={tokens.size.meta}
              style={{
                color: accent,
                letterSpacing: tokens.size.meta * 0.02,
              }}
            >
              {toast.actionLabel.toUpperCase()}
            </Mono>
          </Pressable>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
