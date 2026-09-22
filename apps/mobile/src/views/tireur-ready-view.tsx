import React, { useState } from 'react';
import { View } from 'react-native';

import {
  AppText,
  CountdownRing,
  NoticeBanner,
  PrimaryButton,
  SecondaryButton,
  SecretCard,
  Sheet,
} from '@/components';
import { fr } from '@/i18n/fr';
import { useSecret } from '@/state/use-secret';
import type { UseGame } from '@/state/use-game';
import { useTheme } from '@/theme';
import { CalibrationOffer, CalibrationSheet } from './calibration-panel';
import { isVoiceGame } from './voice-play';

/**
 * The preparation phase, before the first question: the Tireur turns the card
 * over, works out the book's path to that name, and says they are ready. The
 * server holds the game until then, in every mode with a human Tireur.
 *
 * With the chronometer (§9) this is the thinking time, and its countdown is the
 * large ring at the top. A Tireur who cannot find this name in the book may draw
 * another one — at most `redraws_left` more times, and only here: once the
 * questions start the name is fixed and only abandoning is left.
 */
export function TireurReadyView({ sessionId, game }: { sessionId: string; game: UseGame }) {
  const theme = useTheme();
  const { secret, reload } = useSecret(sessionId, true);
  const [revealed, setRevealed] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [redrawn, setRedrawn] = useState(false);
  const voice = isVoiceGame(game);
  const timed = game.state?.timed === true;
  const left = game.state?.redraws_left ?? 0;

  const redraw = async () => {
    setConfirming(false);
    await game.redrawSecret();
    // The card is the one thing the state JSON never carries: read it again.
    await reload();
    setRevealed(false);
    setRedrawn(true);
  };

  return (
    <View testID="tireur-ready" style={{ gap: theme.space.md }}>
      <View style={{ gap: theme.space.xxs }}>
        <AppText variant="display" weight="bold" tight>
          {timed ? fr.ready.thinking : fr.ready.title}
        </AppText>
        <AppText variant="body" tone="soft">
          {timed ? fr.ready.thinkingHint : game.isLocal ? fr.ready.hint : fr.room.readyHint}
        </AppText>
      </View>

      <View testID="think-timer-slot" style={{ alignItems: 'center' }}>
        <CountdownRing countdown={game.countdown} size="lg" label={fr.timer.thinking} testID="think-countdown" />
      </View>

      {redrawn ? <NoticeBanner testID="redraw-done" title={fr.ready.redrawDone} /> : null}

      <SecretCard secret={secret} revealed={revealed} onToggle={() => setRevealed((r) => !r)} />

      {/* Before the first question is the right moment: LOCAL offers it for each new Tireur. */}
      {voice ? <CalibrationOffer local={game.isLocal} onCalibrate={() => setCalibrating(true)} /> : null}

      <PrimaryButton
        testID="tireur-ready-done"
        label={fr.ready.done}
        disabled={game.busy}
        onPress={game.confirmTireurReady}
      />

      {game.canRedraw ? (
        <SecondaryButton
          testID="tireur-redraw"
          label={`${fr.ready.redraw} · ${fr.ready.redrawLeft(left)}`}
          disabled={game.busy}
          onPress={() => setConfirming(true)}
        />
      ) : null}

      <Sheet
        visible={confirming}
        title={fr.ready.redrawTitle}
        hint={fr.ready.redrawBody}
        onClose={() => setConfirming(false)}
        testID="redraw-sheet"
      >
        <View style={{ gap: theme.space.sm }}>
          <PrimaryButton
            testID="redraw-confirm"
            label={fr.ready.redrawConfirm}
            disabled={game.busy}
            onPress={() => void redraw()}
          />
          <SecondaryButton testID="redraw-cancel" label={fr.ready.redrawCancel} onPress={() => setConfirming(false)} />
        </View>
      </Sheet>

      {voice ? <CalibrationSheet visible={calibrating} onClose={() => setCalibrating(false)} /> : null}
    </View>
  );
}
