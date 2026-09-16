import React from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from './app-text';
import { lightFeedback } from '@/lib/haptics';
import { useTheme } from '@/theme';

export interface ChoiceCardProps {
  title: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  /** Shown instead of the radio mark, e.g. "Bientôt". */
  badge?: string;
  testID?: string;
}

/** One option of a single choice on the setup screen: a card with a radio mark. */
export function ChoiceCard({ title, hint, selected, onPress, disabled = false, badge, testID }: ChoiceCardProps) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={badge ? `${title}, ${badge}` : title}
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
        borderColor: selected ? theme.colors.brass : theme.colors.line,
        backgroundColor: selected ? theme.colors.surfaceRaised : pressed ? theme.colors.surface : 'transparent',
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
      {badge ? (
        <View
          style={{
            borderRadius: theme.radius.chip,
            borderWidth: 1.5,
            borderColor: theme.colors.brass,
            paddingHorizontal: theme.space.sm,
            paddingVertical: 2,
          }}
        >
          <AppText variant="micro" weight="semibold" tone="brass">
            {badge}
          </AppText>
        </View>
      ) : (
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            borderWidth: 2,
            borderColor: selected ? theme.colors.brass : theme.colors.inkFaint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.brass }} /> : null}
        </View>
      )}
    </Pressable>
  );
}
