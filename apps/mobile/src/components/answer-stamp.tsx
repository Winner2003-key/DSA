import React, { useEffect } from 'react';
import { View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { answerClass } from '@dsa/core';

import { AppText } from './app-text';
import { RepeatMark } from './repeat-mark';
import { fr } from '@/i18n/fr';
import { useTheme } from '@/theme';

export type StampSize = 'tag' | 'bubble';

export interface AnswerStampProps {
  answerLabel: string;
  /** `tag`: small, on a graph edge or a timeline row. `bubble`: the Tireur's reply. */
  size?: StampSize;
  /** Press the stamp onto the page: it lands from above, a little too big, then settles. */
  stampIn?: boolean;
  delayMs?: number;
  style?: ViewStyle;
  testID?: string;
}

/**
 * An answer as the book prints it on page 2: a coloured tag with the word on it.
 * The colour is the book's (OUI green, NON amber, the repeated codes red, JE NE
 * SAIS PAS blue); the word is always there too, and the repeated codes also carry
 * the stacked-bar mark, so colour is never the only signal.
 *
 * Stamps are slightly turned and inked with an inner rule, so they read as marks
 * made on the page rather than as buttons (brass is for buttons).
 */
export function AnswerStamp({ answerLabel, size = 'tag', stampIn = false, delayMs = 0, style, testID }: AnswerStampProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const cls = answerClass(answerLabel);
  const colors = theme.colors.answers[cls];
  const repeated = cls === 'OUI_REPETE' || cls === 'NON_REPETE';
  const bubble = size === 'bubble';

  const animate = stampIn && !reduceMotion;
  const scale = useSharedValue(animate ? 1.7 : 1);
  const opacity = useSharedValue(animate ? 0 : 1);

  useEffect(() => {
    if (!animate) {
      scale.value = 1;
      opacity.value = 1;
      return;
    }
    scale.value = 1.7;
    opacity.value = 0;
    opacity.value = withDelay(delayMs, withTiming(1, { duration: 90 }));
    scale.value = withDelay(
      delayMs,
      withSequence(
        withTiming(0.94, { duration: 190, easing: Easing.in(Easing.quad) }),
        withTiming(1, { duration: 130, easing: Easing.out(Easing.quad) }),
      ),
    );
  }, [animate, delayMs, opacity, scale, answerLabel]);

  const motion = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }, { rotate: bubble ? '-2deg' : '-3deg' }],
  }));

  return (
    <Animated.View
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={fr.answers[cls]}
      style={[
        {
          alignSelf: 'flex-start',
          backgroundColor: colors.fill,
          borderRadius: bubble ? 18 : 6,
          padding: bubble ? 5 : 2,
        },
        style,
        motion,
      ]}
    >
      <View
        style={{
          borderRadius: bubble ? 14 : 4,
          borderWidth: bubble ? 2 : 1,
          borderColor: colors.ink,
          borderStyle: 'solid',
          opacity: 1,
          paddingHorizontal: bubble ? theme.space.lg : 6,
          paddingVertical: bubble ? theme.space.xs : 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: bubble ? theme.space.sm : 4,
        }}
      >
        {repeated ? <RepeatMark color={colors.ink} size={bubble ? 22 : 10} /> : null}
        <AppText
          variant={bubble ? (cls === 'JE_NE_SAIS_PAS' ? 'title' : 'display') : 'micro'}
          weight="bold"
          tight={bubble}
          style={{ color: colors.ink, lineHeight: bubble ? undefined : 16 }}
        >
          {fr.answers[cls]}
        </AppText>
      </View>
    </Animated.View>
  );
}
