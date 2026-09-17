import React, { useState } from 'react';
import { View } from 'react-native';

import { AppText, PrimaryButton, SecretCard } from '@/components';
import { fr } from '@/i18n/fr';
import { useSecret } from '@/state/use-secret';
import type { UseGame } from '@/state/use-game';
import { useTheme } from '@/theme';
import { CalibrationOffer, CalibrationSheet } from './calibration-panel';
import { isVoiceGame } from './voice-play';

/**
 * `TIREUR_READY`, before the first question: the Tireur turns the card over,
 * learns the name, and says they are ready. On a shared phone (LOCAL) the phone
 * then goes to the Découvreur; in a room, "Je suis prêt" tells the server
 * (`dsa_tireur_ready`) and the Découvreur's phone moves on.
 *
 * This is the §9 thinking phase: its countdown goes in `think-timer-slot`.
 */
export function TireurReadyView({ sessionId, game }: { sessionId: string; game: UseGame }) {
  const theme = useTheme();
  const { secret } = useSecret(sessionId, true);
  const [revealed, setRevealed] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const voice = isVoiceGame(game);

  return (
    <View testID="tireur-ready" style={{ gap: theme.space.md }}>
      <View style={{ gap: theme.space.xxs }}>
        <AppText variant="display" weight="bold" tight>
          {fr.ready.title}
        </AppText>
        <AppText variant="body" tone="soft">
          {game.isLocal ? fr.ready.hint : fr.room.readyHint}
        </AppText>
      </View>
      <View testID="think-timer-slot" />
      <SecretCard secret={secret} revealed={revealed} onToggle={() => setRevealed((r) => !r)} />
      {/* Before the first question is the right moment: LOCAL offers it for each new Tireur. */}
      {voice ? <CalibrationOffer local={game.isLocal} onCalibrate={() => setCalibrating(true)} /> : null}
      <PrimaryButton
        testID="tireur-ready-done"
        label={fr.ready.done}
        disabled={game.busy}
        onPress={game.confirmTireurReady}
      />
      {voice ? <CalibrationSheet visible={calibrating} onClose={() => setCalibrating(false)} /> : null}
    </View>
  );
}
