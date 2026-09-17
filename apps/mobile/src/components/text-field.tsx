import React from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from './app-text';
import { useTheme } from '@/theme';

export interface TextFieldProps extends TextInputProps {
  label: string;
  hint?: string;
  /** Large type for short values such as a room code. */
  large?: boolean;
}

export function TextField({ label, hint, large = false, style, ...input }: TextFieldProps) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space.xxs }}>
      <AppText variant="lead" weight="semibold" tone="soft">
        {label}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={theme.colors.inkFaint}
        {...input}
        style={[
          {
            minHeight: theme.touch.primary,
            borderRadius: theme.radius.field,
            borderWidth: 2,
            borderColor: theme.colors.line,
            backgroundColor: theme.colors.surface,
            paddingHorizontal: theme.space.md,
            color: theme.colors.ink,
            fontFamily: large ? theme.font.bold : theme.font.semibold,
            fontSize: large ? theme.fontSize.display : theme.fontSize.lead,
            letterSpacing: large ? 2 : 0,
          },
          style,
        ]}
      />
      {hint ? (
        <AppText variant="small" tone="faint">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}
