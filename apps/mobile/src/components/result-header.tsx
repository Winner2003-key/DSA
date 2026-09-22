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
 * The game card at the top of the result screen, for every outcome: "Trouvé !",
 * "Temps écoulé" or "Partie arrêtée"; the name; its description only when the
 * name is shared (§8); the counts; and, for a timed game that was won, how long
 * it took out of how long there was ("Trouvé en 1 min 12 s sur 2 min", §9).
 *
 * On a discovery the name lands with a short swell and a brass rule drawn under
 * it — one small moment, then stillness.
 */
export function ResultHeader({ reveal }: { reveal: RevealedPath }) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const discovered = reveal.status === 'DISCOVERED';
  const timeUp = reveal.status === 'TIME_UP';
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

  // "Trouvé en X sur Y", only when the chronometer was on and the name was found.
  const foundIn =
    discovered && stats?.timed && stats.found_in_seconds !== null && stats.play_seconds !== null
      ? fr.result.foundIn(fr.timer.duration(stats.found_in_seconds), fr.timer.duration(stats.play_seconds))
      : null;

  return (
    <View style={{ gap: theme.space.xs }}>
      <AppText variant="title" weight="bold" tight tone={discovered ? 'ink' : 'soft'} testID="result-title">
        {discovered ? `🎉 ${fr.result.title}` : timeUp ? `⏳ ${fr.result.timeUp}` : fr.result.abandoned}
      </AppText>
      {timeUp ? (
        <AppText variant="body" tone="soft" testID="result-time-up-hint">
          {fr.result.timeUpHint}
        </AppText>
      ) : null}
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
      {foundIn ? (
        <AppText variant="lead" weight="semibold" tone="brass" testID="result-found-in">
          {foundIn}
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
