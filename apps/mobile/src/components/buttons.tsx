import React from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

import { AppText } from './app-text';
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
}

/** The main action of a screen: a brass slab with the same physical underside. */
export function PrimaryButton({ label, onPress, disabled = false, hint, testID, style }: ButtonProps) {
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
            minHeight: theme.touch.primary,
            borderRadius: theme.radius.slab,
            backgroundColor: theme.colors.brass,
            borderBottomWidth: pressed ? 2 : 6,
            borderBottomColor: theme.colors.brassEdge,
            marginTop: pressed ? 4 : 0,
            paddingHorizontal: theme.space.lg,
            paddingVertical: theme.space.sm,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AppText variant="title" weight="bold" tight style={{ color: theme.colors.brassInk }}>
            {label}
          </AppText>
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
export function SecondaryButton({ label, onPress, disabled = false, hint, testID, style }: ButtonProps) {
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
          borderWidth: 2,
          borderColor: pressed ? theme.colors.brass : theme.colors.line,
          backgroundColor: pressed ? theme.colors.surfaceRaised : theme.colors.surface,
          paddingHorizontal: theme.space.md,
          paddingVertical: theme.space.sm,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      <AppText variant="lead" weight="semibold">
        {label}
      </AppText>
      {hint ? (
        <AppText variant="small" tone="soft" style={{ textAlign: 'center' }}>
          {hint}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/** A quiet text action with a full-size touch target: "Voir le chemin". */
export function LinkButton({ label, onPress, disabled = false, testID }: ButtonProps) {
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
      })}
    >
      <AppText variant="body" weight="semibold" tone="brass" style={{ textDecorationLine: 'underline' }}>
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
        borderWidth: 1.5,
        borderColor: selected ? theme.colors.brass : theme.colors.line,
        backgroundColor: selected ? theme.colors.brass : pressed ? theme.colors.surfaceRaised : 'transparent',
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <AppText variant="small" weight="semibold" style={selected ? { color: theme.colors.brassInk } : undefined}>
        {label}
      </AppText>
    </Pressable>
  );
}
