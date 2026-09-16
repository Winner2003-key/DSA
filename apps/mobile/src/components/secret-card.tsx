import React from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { AppText } from './app-text';
import { fitVariant } from './fit-variant';
import { fr } from '@/i18n/fr';
import { lightFeedback } from '@/lib/haptics';
import { cardDescription, type Secret } from '@/services/types';
import { useTheme } from '@/theme';

export interface SecretCardProps {
  secret: Secret | null;
  revealed: boolean;
  onToggle: () => void;
  testID?: string;
}

const FLIP_MS = 320;

/**
 * The Tireur's drawn card, as a card: tap it to turn it over. Face down it shows
 * the DSA back; face up, the NAME large — and the description only when another
 * person in the book has the same name (GRAPH_SPECIFICATION §8), because then the
 * Tireur needs it to know which one to have discovered.
 *
 * The name is only in the tree while the card is face up.
 */
export function SecretCard({ secret, revealed, onToggle, testID }: SecretCardProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(0);

  const flip = () => {
    lightFeedback();
    onToggle();
    if (reduceMotion) return;
    // The other face is swapped in edge-on, then the card turns to face the player.
    turn.value = withSequence(
      withTiming(-90, { duration: 0 }),
      withTiming(0, { duration: FLIP_MS, easing: Easing.out(Easing.back(1.2)) }),
    );
  };

  const motion = useAnimatedStyle(() => ({
    transform: [{ perspective: 900 }, { rotateY: `${turn.value}deg` }],
  }));

  const description = secret && revealed ? cardDescription(secret) : null;

  return (
    <Pressable
      testID="secret-toggle"
      accessibilityRole="button"
      accessibilityLabel={revealed ? fr.tireur.hide : fr.tireur.reveal}
      accessibilityHint={fr.tireur.flipHint}
      onPress={flip}
    >
      <Animated.View
        testID={testID ?? 'secret-card'}
        style={[
          {
            minHeight: 188,
            borderRadius: theme.radius.secret,
            padding: 7,
            backgroundColor: revealed ? theme.colors.surfaceRaised : theme.colors.brass,
            borderBottomWidth: 5,
            borderBottomColor: revealed ? theme.colors.line : theme.colors.brassEdge,
          },
          motion,
        ]}
      >
        <View
          style={{
            flex: 1,
            minHeight: 170,
            borderRadius: theme.radius.secret - 6,
            borderWidth: 1.5,
            borderColor: revealed ? theme.colors.brass : theme.colors.brassInk,
            padding: theme.space.lg,
            justifyContent: 'space-between',
            gap: theme.space.xs,
          }}
        >
          {revealed && secret ? (
            <>
              <AppText variant="small" tone="soft">
                {fr.tireur.card}
              </AppText>
              <AppText variant={fitVariant(secret.name)} weight="bold" tight testID="secret-name">
                {secret.name}
              </AppText>
              {description ? (
                <AppText variant="body" tone="soft" testID="secret-description">
                  {description}
                </AppText>
              ) : (
                <View />
              )}
              <AppText variant="micro" tone="faint" style={{ alignSelf: 'flex-end' }}>
                {fr.tireur.hide}
              </AppText>
            </>
          ) : (
            <>
              <AppText variant="small" weight="semibold" style={{ color: theme.colors.brassInk, opacity: 0.8 }}>
                {fr.tireur.card}
              </AppText>
              <AppText
                variant="colossal"
                weight="bold"
                tight
                style={{ color: theme.colors.brassInk, textAlign: 'center', opacity: 0.9 }}
              >
                DSA
              </AppText>
              <AppText variant="small" weight="semibold" style={{ color: theme.colors.brassInk, textAlign: 'center' }}>
                {fr.tireur.flipHint}
              </AppText>
            </>
          )}
        </View>
      </Animated.View>
    </Pressable>
  );
}
