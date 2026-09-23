import React from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from './app-text';
import { Check, IconTile, type LucideIcon } from './icon';
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
  icon?: LucideIcon;
  /** Half-width tile with no mark: two of them sit side by side. */
  compact?: boolean;
  /** The warm accent instead of the action colour (the Découvreur's seat). */
  tone?: 'brass' | 'accent';
}

/** One option of a single choice: an icon tile, a title, and a tick when chosen. */
export function ChoiceCard({
  title,
  hint,
  selected,
  onPress,
  disabled = false,
  badge,
  testID,
  icon,
  compact = false,
  tone = 'brass',
}: ChoiceCardProps) {
  const theme = useTheme();
  const ink = tone === 'accent' ? theme.colors.accent : theme.colors.brass;
  const soft = tone === 'accent' ? theme.colors.accentSoft : theme.colors.brassSoft;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={badge ? `${title}, ${badge}` : title}
      accessibilityHint={hint}
      disabled={disabled}
      onPress={() => {
        lightFeedback();
        onPress();
      }}
      style={({ pressed }) => ({
        flex: compact ? 1 : undefined,
        minHeight: compact ? theme.touch.secondary : theme.touch.primary,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space.sm,
        borderRadius: theme.radius.slab,
        borderWidth: 1,
        borderLeftWidth: selected && !compact ? 4 : 1,
        borderColor: selected ? ink : theme.colors.line,
        backgroundColor: selected ? soft : pressed ? theme.colors.surface : theme.colors.surfaceRaised,
        paddingHorizontal: theme.space.sm,
        paddingVertical: theme.space.xs,
        opacity: disabled ? 0.55 : 1,
      })}
    >
      {icon ? <IconTile icon={icon} selected={selected} tone={tone} /> : null}
      <View style={{ flex: 1 }}>
        <AppText variant={compact ? 'small' : 'body'} weight="semibold" numberOfLines={compact ? 1 : undefined}>
          {title}
        </AppText>
        {hint && !compact ? (
          <AppText variant="micro" tone="soft">
            {hint}
          </AppText>
        ) : null}
      </View>
      {badge ? (
        <View
          style={{
            borderRadius: theme.radius.chip,
            borderWidth: 1,
            borderColor: ink,
            paddingHorizontal: theme.space.sm,
            paddingVertical: 2,
          }}
        >
          <AppText variant="micro" weight="semibold" tone="brass">
            {badge}
          </AppText>
        </View>
      ) : compact ? null : (
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            borderWidth: selected ? 0 : 1.5,
            borderColor: theme.colors.line,
            backgroundColor: selected ? ink : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected ? <Check size={15} color={theme.colors.brassInk} strokeWidth={2.6} /> : null}
        </View>
      )}
    </Pressable>
  );
}

