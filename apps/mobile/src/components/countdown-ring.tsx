import React from 'react';
import { View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { AppText } from './app-text';
import { fr } from '@/i18n/fr';
import type { Countdown } from '@/state/use-countdown';
import { useTheme } from '@/theme';

export interface CountdownRingProps {
  countdown: Countdown;
  /** `sm` for the game header, `lg` for the preparation views. */
  size?: 'sm' | 'lg';
  /** A line under the ring ("Temps pour réfléchir"). */
  label?: string;
  testID?: string;
}

const SIZES = { sm: { box: 52, stroke: 5, variant: 'small' as const }, lg: { box: 104, stroke: 8, variant: 'title' as const } };

/**
 * The time left, as a ring that empties. It is the same object in the header
 * during play and in the preparation views, so a player learns it once.
 *
 * The last 30 s and the last 10 s change its colour, and the number is always
 * written out: the ring alone would be a colour-only signal, which nobody who
 * cannot tell amber from red can read. The countdown itself is computed from the
 * server's clock (`useCountdown`), never from this phone's.
 */
export function CountdownRing({ countdown, size = 'sm', label, testID = 'countdown' }: CountdownRingProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const { box, stroke, variant } = SIZES[size];

  if (!countdown.running) return null;

  const tone =
    countdown.level === 'LAST_CALL' || countdown.level === 'UP'
      ? theme.colors.answers.OUI_REPETE.fill
      : countdown.level === 'WARNING'
        ? theme.colors.answers.NON.fill
        : theme.colors.brass;

  const radius = (box - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // Reduced motion: the ring still shows how much is left, it just never sweeps
  // below a whole second, so nothing on screen moves continuously.
  const fraction = reduceMotion
    ? Math.min(1, Math.ceil(countdown.fraction * countdown.secondsLeft) / Math.max(1, countdown.secondsLeft))
    : countdown.fraction;

  return (
    <View
      testID={testID}
      accessibilityRole="timer"
      accessibilityLabel={`${label ?? fr.timer.label} : ${fr.timer.a11y(countdown.secondsLeft)}`}
      accessibilityLiveRegion={countdown.level === 'LAST_CALL' ? 'polite' : 'none'}
      style={{ alignItems: 'center', gap: theme.space.xxs }}
    >
      <View style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={box} height={box} style={{ position: 'absolute' }}>
          <Circle cx={box / 2} cy={box / 2} r={radius} stroke={theme.colors.line} strokeWidth={stroke} fill="none" />
          <Circle
            cx={box / 2}
            cy={box / 2}
            r={radius}
            stroke={tone}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            // Start at twelve o'clock and empty clockwise, like a kitchen timer.
            transform={`rotate(-90 ${box / 2} ${box / 2})`}
          />
        </Svg>
        <AppText variant={variant} weight="bold" tight testID={`${testID}-value`} style={{ color: tone }}>
          {fr.timer.clock(countdown.secondsLeft)}
        </AppText>
      </View>
      {label ? (
        <AppText variant="micro" weight="semibold" tone="soft" testID={`${testID}-label`}>
          {label}
        </AppText>
      ) : null}
    </View>
  );
}
