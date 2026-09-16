import React from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import type { AnswerClass } from '@dsa/core';

import { AppText } from './app-text';
import { RepeatMark } from './repeat-mark';
import { fr } from '@/i18n/fr';
import { tapFeedback } from '@/lib/haptics';
import { useTheme } from '@/theme';

export interface AnswerSlabProps {
  answerClass: AnswerClass;
  onPress: () => void;
  disabled?: boolean;
  /** Half-width slabs sit side by side; full-width ones stack. */
  half?: boolean;
  testID?: string;
}

const EDGE = 6;
const PRESSED_EDGE = 2;

/**
 * The one element the whole app is built around: a slab with a solid underside
 * that collapses when pressed, so answering feels like pressing a key rather than
 * tapping glass. OUI is warm and light, NON is cool and dark — two independent
 * signals, readable without colour vision and without reading.
 */
export function AnswerSlab({ answerClass, onPress, disabled = false, half = false, testID }: AnswerSlabProps) {
  const theme = useTheme();
  const colors = theme.colors.answers[answerClass];
  const repeated = answerClass === 'OUI_REPETE' || answerClass === 'NON_REPETE';
  const long = answerClass === 'JE_NE_SAIS_PAS';

  const container: ViewStyle = {
    flex: half ? 1 : undefined,
    width: half ? undefined : '100%',
    opacity: disabled ? 0.45 : 1,
  };

  return (
    <Pressable
      testID={testID ?? `answer-${answerClass}`}
      accessibilityRole="button"
      accessibilityLabel={fr.answers[answerClass]}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={container}
    >
      {({ pressed }) => (
        <View
          style={{
            minHeight: theme.touch.answer,
            borderRadius: theme.radius.slab,
            backgroundColor: colors.fill,
            borderBottomWidth: pressed ? PRESSED_EDGE : EDGE,
            borderBottomColor: colors.edge,
            marginTop: pressed ? EDGE - PRESSED_EDGE : 0,
            paddingHorizontal: theme.space.md,
            paddingVertical: theme.space.sm,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: repeated ? 'flex-start' : 'center',
            gap: theme.space.sm,
          }}
        >
          {repeated ? <RepeatMark color={colors.ink} /> : null}
          <AppText
            variant={long ? 'lead' : 'title'}
            weight="bold"
            tight
            numberOfLines={1}
            adjustsFontSizeToFit
            style={{ color: colors.ink, flexShrink: 1 }}
          >
            {fr.answers[answerClass]}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}
