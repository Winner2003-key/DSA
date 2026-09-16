import React from 'react';
import { ScrollView, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

export interface ScreenProps {
  children: React.ReactNode;
  /** Wraps the content in a ScrollView. Off for screens that manage their own. */
  scroll?: boolean;
  /** Extra bottom room for a fixed action bar. */
  footer?: React.ReactNode;
  style?: ViewStyle;
  testID?: string;
}

/**
 * The reading column. Content is capped and centred so a 1440 px browser window
 * shows the same one-thumb layout as a phone rather than a stretched form.
 */
export function Screen({ children, scroll = false, footer, style, testID }: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const column: ViewStyle = {
    width: '100%',
    maxWidth: theme.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: theme.space.lg,
  };

  const body = <View style={[column, style]}>{children}</View>;

  return (
    <View testID={testID} style={{ flex: 1, backgroundColor: theme.colors.bg, paddingTop: insets.top }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: theme.space.xxl, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{body}</View>
      )}
      {footer ? (
        <View
          style={[
            column,
            {
              paddingTop: theme.space.sm,
              paddingBottom: Math.max(insets.bottom, theme.space.md),
              borderTopWidth: 1,
              borderTopColor: theme.colors.line,
              backgroundColor: theme.colors.bg,
              maxWidth: theme.maxContentWidth,
            },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}
