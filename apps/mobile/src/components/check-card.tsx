import React from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from './app-text';
import { lightFeedback } from '@/lib/haptics';
import { useTheme } from '@/theme';

export interface CheckCardProps {
  title: string;
  hint?: string;
  checked: boolean;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}

/**
 * A switch you either want or you don't, laid out like `ChoiceCard` so the setup
 * screen reads as one list. The mark is a tick in a square, not a radio circle:
 * the one on the line above is a choice between options, this one is a yes/no.
 */
export function CheckCard({ title, hint, checked, onPress, disabled = false, testID }: CheckCardProps) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={title}
      accessibilityHint={hint}
      disabled={disabled}
      onPress={() => {
        lightFeedback();
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: theme.touch.primary,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space.md,
        borderRadius: theme.radius.slab,
        borderWidth: 2,
        borderColor: checked ? theme.colors.brass : theme.colors.line,
        backgroundColor: checked ? theme.colors.surfaceRaised : pressed ? theme.colors.surface : 'transparent',
        paddingHorizontal: theme.space.md,
        paddingVertical: theme.space.sm,
        opacity: disabled ? 0.55 : 1,
      })}
    >
      <View style={{ flex: 1 }}>
        <AppText variant="lead" weight="semibold">
          {title}
        </AppText>
        {hint ? (
          <AppText variant="small" tone="soft">
            {hint}
          </AppText>
        ) : null}
      </View>
      <View
        testID={testID ? `${testID}-mark` : undefined}
        style={{
          width: 26,
          height: 26,
          borderRadius: 7,
          borderWidth: 2,
          borderColor: checked ? theme.colors.brass : theme.colors.inkFaint,
          backgroundColor: checked ? theme.colors.brass : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? (
          <AppText variant="small" weight="bold" style={{ color: theme.colors.brassInk, lineHeight: 18 }}>
            ✓
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}
