import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppText } from './app-text';
import { useTheme } from '@/theme';

export interface NoticeBannerProps {
  title: string;
  hint?: string;
  /** "warn" for problems the player should act on, "info" for things that resolve themselves. */
  tone?: 'info' | 'warn';
  busy?: boolean;
  children?: React.ReactNode;
  testID?: string;
}

/** A state of the room that isn't an error: reconnecting, the other player away or gone, an offer. */
export function NoticeBanner({ title, hint, tone = 'info', busy = false, children, testID }: NoticeBannerProps) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: theme.colors.surfaceRaised,
        borderRadius: theme.radius.field,
        borderLeftWidth: 4,
        borderLeftColor: tone === 'warn' ? theme.colors.danger : theme.colors.brass,
        padding: theme.space.md,
        gap: theme.space.xs,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
        {busy ? <ActivityIndicator color={theme.colors.brass} /> : null}
        <AppText variant="body" weight="semibold" style={{ flex: 1 }}>
          {title}
        </AppText>
      </View>
      {hint ? (
        <AppText variant="small" tone="soft">
          {hint}
        </AppText>
      ) : null}
      {children}
    </View>
  );
}
