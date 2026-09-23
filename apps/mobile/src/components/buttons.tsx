import React from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

import { AppText } from './app-text';
import { ICON_STROKE, type LucideIcon } from './icon';
import { lightFeedback } from '@/lib/haptics';
import { useTheme } from '@/theme';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Small muted line under the label, for the mode and role choices. */
  hint?: string;
  testID?: string;
  style?: ViewStyle;
  /** Drawn before the label. */
  icon?: LucideIcon;
}

/** The main action of a screen: a flat filled bar, icon then label. */
export function PrimaryButton({ label, onPress, disabled = false, hint, testID, style, icon: Icon }: ButtonProps) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        lightFeedback();
        onPress();
      }}
      style={[{ width: '100%', opacity: disabled ? 0.45 : 1 }, style]}
    >
      {({ pressed }) => (
        <View
          style={{
            minHeight: theme.touch.secondary,
            borderRadius: theme.radius.slab,
            backgroundColor: pressed ? theme.colors.brassEdge : theme.colors.brass,
            paddingHorizontal: theme.space.lg,
            paddingVertical: theme.space.sm,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xs }}>
            {Icon ? <Icon size={20} color={theme.colors.brassInk} strokeWidth={ICON_STROKE} /> : null}
            <AppText variant="lead" weight="semibold" style={{ color: theme.colors.brassInk }}>
              {label}
            </AppText>
          </View>
          {hint ? (
            <AppText variant="small" style={{ color: theme.colors.brassInk, opacity: 0.75, textAlign: 'center' }}>
              {hint}
            </AppText>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

/** Outlined, quieter, still full-size: "Proposer un nom", "Revenir à une question". */
export function SecondaryButton({ label, onPress, disabled = false, hint, testID, style, icon: Icon }: ButtonProps) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        lightFeedback();
        onPress();
      }}
      style={({ pressed }) => [
        {
          width: '100%',
          minHeight: theme.touch.secondary,
          borderRadius: theme.radius.slab,
          borderWidth: 1,
          borderColor: pressed ? theme.colors.brass : theme.colors.line,
          backgroundColor: pressed ? theme.colors.brassSoft : theme.colors.surfaceRaised,
          paddingHorizontal: theme.space.md,
          paddingVertical: theme.space.sm,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xs }}>
        {Icon ? <Icon size={20} color={theme.colors.brass} strokeWidth={ICON_STROKE} /> : null}
        <AppText variant="body" weight="semibold">
          {label}
        </AppText>
      </View>
      {hint ? (
        <AppText variant="small" tone="soft" style={{ textAlign: 'center' }}>
          {hint}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/** A quiet text action with a full-size touch target: "Voir le chemin". */
export function LinkButton({ label, onPress, disabled = false, testID, icon: Icon }: ButtonProps) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        lightFeedback();
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: theme.touch.secondary,
        alignSelf: 'center',
        paddingHorizontal: theme.space.lg,
        justifyContent: 'center',
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space.xs,
      })}
    >
      {Icon ? <Icon size={18} color={theme.colors.brass} strokeWidth={ICON_STROKE} /> : null}
      <AppText variant="body" weight="semibold" tone="brass">
        {label}
      </AppText>
    </Pressable>
  );
}

/** A pill used for "Bientôt", the rewind counts and the theme switch. */
export function Chip({
  label,
  onPress,
  selected = false,
  disabled = false,
  testID,
  accessibilityLabel,
}: {
  label: string;
  onPress?: () => void;
  selected?: boolean;
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ disabled, selected }}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: theme.touch.icon,
        minWidth: theme.touch.icon,
        paddingHorizontal: theme.space.md,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radius.chip,
        borderWidth: 1,
        borderColor: selected ? theme.colors.brass : theme.colors.line,
        backgroundColor: selected ? theme.colors.brass : pressed ? theme.colors.brassSoft : theme.colors.surfaceRaised,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <AppText variant="small" weight="semibold" style={selected ? { color: theme.colors.brassInk } : undefined}>
        {label}
      </AppText>
    </Pressable>
  );
}
