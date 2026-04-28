import { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import * as Haptics from 'expo-haptics';

/**
 * HapticTab — soft haptic on tab press. Both iOS and Android support
 * Haptics.selectionAsync() (Android maps it to a short OS vibration when
 * the device's vibrator is enabled). Errors are swallowed silently so a
 * device without haptics doesn't break the tab.
 */
export function HapticTab(props: BottomTabBarButtonProps) {
  return (
    <PlatformPressable
      {...props}
      onPressIn={(ev) => {
        Haptics.selectionAsync().catch(() => {
          /* device has no haptic hardware or permission denied — silent */
        });
        props.onPressIn?.(ev);
      }}
    />
  );
}
