import type { ReactElement } from 'react';
import { View } from 'react-native';

import { tokens } from '@/constants/theme';

interface DividerProps {
  /** Left padding — for use inside a row stack that should keep the hairline aligned with content. */
  inset?: number;
  /** Which side the hairline draws on. Defaults to 'bottom'. */
  direction?: 'top' | 'bottom';
}

export function Divider({ inset, direction = 'bottom' }: DividerProps = {}): ReactElement {
  const borderKey = direction === 'top' ? 'borderTopWidth' : 'borderBottomWidth';
  const colorKey = direction === 'top' ? 'borderTopColor' : 'borderBottomColor';
  return (
    <View
      style={{
        [borderKey]: 0.5,
        [colorKey]: tokens.color.border.subtle,
        marginLeft: inset,
      }}
    />
  );
}
