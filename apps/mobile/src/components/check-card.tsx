import React from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from './app-text';
import { IconTile, type LucideIcon } from './icon';
import { lightFeedback } from '@/lib/haptics';
import { useTheme } from '@/theme';

export interface CheckCardProps {
  title: string;
  hint?: string;
  checked: boolean;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  icon?: LucideIcon;
  /** Half-width tile, two side by side (Voix and Chronomètre on the setup screen). */
  compact?: boolean;
}

/**
 * An on/off setting drawn as a switch, laid out like `ChoiceCard` so the setup
 * screen reads as one set. The radio tick above is a choice between options;
 * this switch is a yes or no.
 */
export function CheckCard({ title, hint, checked, onPress, disabled = false, testID, icon, compact = false }: CheckCardProps) {
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
        flex: compact ? 1 : undefined,
        minHeight: theme.touch.secondary,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space.xs,
        borderRadius: theme.radius.slab,
        borderWidth: 1,
        borderColor: theme.colors.line,
        backgroundColor: pressed ? theme.colors.surface : theme.colors.surfaceRaised,
        paddingHorizontal: theme.space.sm,
        paddingVertical: theme.space.xs,
        opacity: disabled ? 0.55 : 1,
      })}
    >
      {icon ? <IconTile icon={icon} selected={checked} /> : null}
      <View style={{ flex: 1 }}>
        <AppText variant="small" weight="semibold" numberOfLines={1}>
          {title}
        </AppText>
        {hint ? (
          <AppText variant="micro" tone="soft" numberOfLines={compact ? 1 : undefined}>
            {hint}
          </AppText>
        ) : null}
      </View>
      <View
        testID={testID ? `${testID}-mark` : undefined}
        style={{
          width: 34,
          height: 20,
          borderRadius: 10,
          padding: 2,
          backgroundColor: checked ? theme.colors.brass : theme.colors.line,
          alignItems: checked ? 'flex-end' : 'flex-start',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: theme.colors.surfaceRaised }} />
      </View>
    </Pressable>
  );
}
