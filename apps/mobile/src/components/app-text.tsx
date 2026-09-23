import React from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';

import { uiFamily, useTheme } from '@/theme';

export type TextVariant = 'micro' | 'small' | 'body' | 'lead' | 'title' | 'display' | 'hero' | 'colossal';
export type TextTone = 'ink' | 'soft' | 'faint' | 'brass' | 'danger' | 'inherit';

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: TextTone;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  /** Tightens tracking on the very large sizes, where default spacing looks loose. */
  tight?: boolean;
  /** Forces the slab on a small size (a question or a name), or the sans on a big one. */
  face?: 'slab' | 'ui';
}

const UI_WEIGHT = { regular: '400', medium: '500', semibold: '600', bold: '700' } as const;
const SLAB_BY_DEFAULT: readonly TextVariant[] = ['title', 'display', 'hero', 'colossal'];

export function AppText({
  variant = 'body',
  tone = 'ink',
  weight = 'regular',
  tight,
  face,
  style,
  ...rest
}: AppTextProps) {
  const theme = useTheme();
  const color: Record<TextTone, string | undefined> = {
    ink: theme.colors.ink,
    soft: theme.colors.inkSoft,
    faint: theme.colors.inkFaint,
    brass: theme.colors.brass,
    danger: theme.colors.danger,
    inherit: undefined,
  };

  const base: TextStyle = {
    ...((face ?? (SLAB_BY_DEFAULT.includes(variant) ? 'slab' : 'ui')) === 'slab'
      ? { fontFamily: theme.font[weight] }
      : { fontFamily: uiFamily, fontWeight: UI_WEIGHT[weight] }),
    fontSize: theme.fontSize[variant],
    lineHeight: theme.lineHeight[variant],
    color: color[tone],
  };
  if (tight) base.letterSpacing = variant === 'colossal' || variant === 'hero' ? -1.2 : -0.4;

  return <Text {...rest} style={[base, style]} />;
}
