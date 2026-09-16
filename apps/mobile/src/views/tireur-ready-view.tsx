import React, { useState } from 'react';
import { View } from 'react-native';

import { AppText, PrimaryButton, SecretCard } from '@/components';
import { fr } from '@/i18n/fr';
import { useSecret } from '@/state/use-secret';
import type { UseGame } from '@/state/use-game';
import { useTheme } from '@/theme';

/**
 * LOCAL, before the first question: the phone is in the Tireur's hands, they turn
 * the card over, learn the name, and hand the phone to the Découvreur
 * (`TIREUR_READY` in useGame). The §9 thinking time will live here.
 */
export function TireurReadyView({ sessionId, game }: { sessionId: string; game: UseGame }) {
  const theme = useTheme();
  const { secret } = useSecret(sessionId, true);
  const [revealed, setRevealed] = useState(false);

  return (
    <View testID="tireur-ready" style={{ gap: theme.space.md }}>
      <View style={{ gap: theme.space.xxs }}>
        <AppText variant="display" weight="bold" tight>
          {fr.ready.title}
        </AppText>
        <AppText variant="body" tone="soft">
          {fr.ready.hint}
        </AppText>
      </View>
      <SecretCard secret={secret} revealed={revealed} onToggle={() => setRevealed((r) => !r)} />
      <PrimaryButton testID="tireur-ready-done" label={fr.ready.done} onPress={game.confirmTireurReady} />
    </View>
  );
}
