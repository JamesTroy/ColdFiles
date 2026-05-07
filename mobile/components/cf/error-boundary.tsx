/**
 * ErrorBoundary — top-level React error boundary.
 *
 * Class component because hooks have no `componentDidCatch` equivalent (still
 * true in React 19). Wraps the root tree in app/_layout.tsx so any thrown
 * render error surfaces a calm fallback UI instead of unmounting the React
 * root — which on Android Fabric otherwise reads as a blank grey screen, the
 * exact failure mode `feedback_hooks_before_early_returns.md` calls out.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { tokens } from '@/constants/theme';

import { SansMedium, SerifTitle } from './text';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** onError seam: wire crash reporter here when one is adopted. */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(_error: Error): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.warn('[error-boundary] render error caught', error?.message ?? String(error));
    this.reportError(error, errorInfo);
  }

  reportError(error: Error, errorInfo: ErrorInfo): void {
    const { onError } = this.props;
    if (onError) onError(error, errorInfo);
  }

  reset = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <View
        style={{
          flex: 1,
          backgroundColor: tokens.color.bg.base,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 32,
        }}
      >
        <SerifTitle
          size="h1"
          style={{
            fontSize: 56,
            color: tokens.color.text.secondary,
            lineHeight: 56,
            marginBottom: 16,
          }}
        >
          —
        </SerifTitle>
        <SansMedium
          style={{
            color: tokens.color.text.primary,
            textAlign: 'center',
            marginBottom: 24,
          }}
        >
          Something broke. Tap to reload.
        </SansMedium>
        <Pressable
          onPress={this.reset}
          accessibilityRole="button"
          accessibilityLabel="Reload"
          style={({ pressed }) => [
            {
              paddingVertical: 12,
              paddingHorizontal: 22,
              borderRadius: 8,
              borderWidth: 0.5,
              borderColor: tokens.color.accent.amber,
              backgroundColor: tokens.color.bg.amberTintCard,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <SansMedium style={{ color: tokens.color.accent.amber, fontSize: 14 }}>
            Reload
          </SansMedium>
        </Pressable>
      </View>
    );
  }
}
