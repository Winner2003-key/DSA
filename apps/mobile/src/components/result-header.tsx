import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { AppText } from './app-text';
import { fitVariant } from './fit-variant';
import { fr } from '@/i18n/fr';
import { successFeedback } from '@/lib/haptics';
import { cardDescription, type RevealedPath } from '@/services/types';
import { useTheme } from '@/theme';

/**
 * The top of the result screen: "Trouvé !", the name, its description only when the
 * name is shared (§8), and the server's counts. On a discovery the name lands with
 * a short swell and a brass rule drawn under it — one small moment, then stillness.
 */
export function ResultHeader({ reveal }: { reveal: RevealedPath }) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const discovered = reveal.status === 'DISCOVERED';
  const secret = reveal.secret;
  const description = secret ? cardDescription(secret) : null;

  const swell = useSharedValue(discovered && !reduceMotion ? 0.6 : 1);
  const rule = useSharedValue(discovered && !reduceMotion ? 0 : 1);

  useEffect(() => {
    if (!discovered) return;
    successFeedback();
    if (reduceMotion) return;
    swell.value = withSequence(
      withTiming(1.08, { duration: 260, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 160 }),
    );
    rule.value = withDelay(220, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
  }, [discovered, reduceMotion, rule, swell]);

  const nameMotion = useAnimatedStyle(() => ({ opacity: Math.min(1, swell.value * 1.4 - 0.4), transform: [{ scale: swell.value }] }));
  const ruleMotion = useAnimatedStyle(() => ({ transform: [{ scaleX: rule.value }] }));

  const stats = reveal.stats;
  const lines = stats
    ? [
        `${stats.questions} ${stats.questions === 1 ? fr.result.statQuestion : fr.result.statQuestions}`,
        `${stats.non} ${fr.result.statNon}`,
        `${stats.backs + stats.rewinds} ${stats.backs + stats.rewinds === 1 ? fr.result.statBack : fr.result.statBacks}`,
      ]
    : [];

  return (
    <View style={{ gap: theme.space.xs }}>
      <AppText variant="title" weight="bold" tight tone={discovered ? 'ink' : 'soft'} testID="result-title">
        {discovered ? `🎉 ${fr.result.title}` : fr.result.abandoned}
      </AppText>
      {secret ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <Animated.View style={[{ transformOrigin: 'left center' }, nameMotion]}>
            <AppText variant={fitVariant(secret.name)} weight="bold" tight tone="brass" testID="result-name">
              {secret.name}
            </AppText>
          </Animated.View>
          {discovered ? (
            <Animated.View
              style={[{ height: 4, borderRadius: 2, backgroundColor: theme.colors.brass, transformOrigin: 'left center' }, ruleMotion]}
            />
          ) : null}
        </View>
      ) : null}
      {description ? (
        <AppText variant="body" tone="soft" testID="result-description">
          {description}
        </AppText>
      ) : null}
      {lines.length > 0 ? (
        <View testID="result-stats" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md }}>
          {lines.map((line) => (
            <AppText key={line} variant="small" weight="semibold" tone="faint">
              {line}
            </AppText>
          ))}
        </View>
      ) : null}
    </View>
  );
}
