import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppText, CountdownRing, NoticeBanner } from '@/components';
import { fr } from '@/i18n/fr';
import type { UseGame } from '@/state/use-game';
import { useTheme } from '@/theme';

/**
 * The Découvreur during the preparation phase. Nothing about the card is known on
 * this device — and nothing ever will be until the end.
 *
 * With the chronometer the same countdown runs here, so both players see the same
 * seconds; if the Tireur draws another name, this side is told that it happened,
 * and never which name (§9).
 */
export function DecouvreurWaitingView({ game }: { game: UseGame }) {
  const theme = useTheme();
  const timed = game.state?.timed === true;

  return (
    <View
      testID="decouvreur-waiting-tireur"
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.card,
        padding: theme.space.xl,
        gap: theme.space.md,
        alignItems: 'center',
      }}
    >
      <View testID="think-timer-slot">
        <CountdownRing countdown={game.countdown} size="lg" label={fr.timer.thinking} testID="think-countdown" />
      </View>
      {timed ? null : <ActivityIndicator size="large" color={theme.colors.brass} />}
      <AppText variant="title" weight="bold" tight style={{ textAlign: 'center' }}>
        {timed ? fr.room.tireurThinking : fr.room.tireurLooking}
      </AppText>
      <AppText variant="body" tone="soft" style={{ textAlign: 'center' }}>
        {timed ? fr.room.tireurThinkingHint : fr.room.tireurLookingHint}
      </AppText>
      {game.otherRedrew ? (
        <NoticeBanner testID="other-redrew" title={fr.room.tireurRedrew} />
      ) : null}
    </View>
  );
}
