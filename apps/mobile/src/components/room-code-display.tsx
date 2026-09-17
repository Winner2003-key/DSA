import React from 'react';
import { View } from 'react-native';

import { AppText } from './app-text';
import { useTheme } from '@/theme';

/**
 * The room code, read across a table: "DSA-" quiet, the four digits large and
 * spaced, so it can be said aloud digit by digit.
 */
export function RoomCodeDisplay({ code, testID = 'room-code' }: { code: string; testID?: string }) {
  const theme = useTheme();
  const digits = code.replace(/^DSA-/, '');
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Code ${code.split('').join(' ')}`}
      style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: theme.space.xs }}
    >
      <AppText variant="title" weight="semibold" tone="soft">
        DSA-
      </AppText>
      <AppText
        variant="colossal"
        weight="bold"
        tone="brass"
        testID={`${testID}-digits`}
        style={{ letterSpacing: 8, fontVariant: ['tabular-nums'] }}
      >
        {digits}
      </AppText>
    </View>
  );
}
