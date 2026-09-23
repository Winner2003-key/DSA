import React, { useRef } from 'react';
import { View } from 'react-native';
import { buildTranscribeHint } from '@dsa/voice';

import { AppText, NoticeBanner, SecondaryButton, VoiceButton } from '@/components';
import { fr } from '@/i18n/fr';
import { guessConfirmation, interpretDecouvreur, interpretTireur } from '@/speech/interpret';
import { useSpeech } from '@/speech/use-speech';
import { useVoiceTurn, type VoiceTurn } from '@/speech/use-voice-turn';
import { useVoiceSettings } from '@/speech/voice-settings';
import type { UseGame } from '@/state/use-game';
import { useTheme } from '@/theme';
import { X } from '@/components';

/** Voice was chosen for this game ("Façon de jouer : Voix"). */
export function isVoiceGame(game: UseGame): boolean {
  return game.state?.settings?.input_mode === 'VOICE';
}

/**
 * The microphone block of a game screen: the fallback banner, the microphone
 * with its live state, and what was heard. A voice game has no answer buttons:
 * when the voice cannot work, the banner says to start again with Boutons.
 */
function VoicePanel({ turn, enabled, instruction, testID }: { turn: VoiceTurn; enabled: boolean; instruction: string; testID: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ gap: theme.space.xs }}>
      {turn.fallback ? (
        <NoticeBanner testID="voice-fallback" tone="warn" title={turn.fallback} hint={fr.voice.restartWithButtons}>
          <SecondaryButton testID="voice-fallback-close" icon={X} label={fr.app.close} onPress={turn.dismissFallback} />
        </NoticeBanner>
      ) : null}
      {turn.off ? null : (
        <>
          <VoiceButton
            phase={turn.phase}
            level={turn.level}
            locked={turn.locked}
            disabled={!enabled}
            pressIn={turn.pressIn}
            pressOut={turn.pressOut}
            lock={turn.lock}
            tap={turn.tap}
          />
          {enabled && turn.phase === 'idle' && !turn.heard && !turn.notice ? (
            <AppText variant="small" tone="soft">
              {instruction}
            </AppText>
          ) : null}
          {turn.heard ? (
            <AppText variant="body" weight="semibold" testID="voice-heard">
              {fr.voice.heard(turn.heard)}
            </AppText>
          ) : null}
          {turn.notice ? (
            <AppText variant="body" tone="danger" testID="voice-notice">
              {turn.notice}
            </AppText>
          ) : null}
        </>
      )}
    </View>
  );
}

export interface DecouvreurVoiceProps {
  game: UseGame;
  names: string[];
}

/**
 * The Découvreur speaks: "Ancien ?" asks, "Absalom !" calls a name, "revenir à
 * Pentateuque" goes back. The same `useGame` actions as the buttons of a game
 * played with Boutons; here there are none, so a "revenir" that names no
 * question is asked again, out loud.
 */
export function DecouvreurVoice({ game, names }: DecouvreurVoiceProps) {
  const { speak } = useSpeech();
  const { state } = game;
  // The countdown reaching zero closes the microphone at once, without waiting
  // for the server to confirm TIME_UP: a recording in flight is dropped, never
  // transcribed and never sent (§9).
  const timeUp = game.countdown.level === 'UP';
  const myTurn = state?.status === 'PLAYING' && state.awaiting === 'QUESTION' && !game.outgoing;
  const enabled = Boolean(myTurn && !game.busy && !timeUp);

  const latest = useRef({ game, names });
  latest.current = { game, names };

  const turn = useVoiceTurn({
    enabled,
    hint: () => {
      const current = latest.current.game.state;
      return buildTranscribeHint(current?.prompt?.text ?? null, latest.current.names, {
        context: current?.path.map((entry) => entry.text) ?? [],
      });
    },
    onTranscript: async (text) => {
      const { game: now, names: known } = latest.current;
      const current = now.state;
      if (!current || current.awaiting !== 'QUESTION' || current.status !== 'PLAYING') return;
      const action = interpretDecouvreur(text, current, known);
      switch (action.kind) {
        case 'ASK':
          await now.ask();
          return;
        case 'GUESS':
          await now.guess(action.name);
          return;
        case 'BACK':
          if (action.stepIndex !== null) {
            await now.goBack(action.stepIndex);
            return;
          }
          turn.setNotice(fr.voice.backWhere);
          speak(fr.voice.backWhere);
          return;
        default:
          turn.setNotice(fr.voice.notUnderstood);
          speak(fr.voice.notUnderstood);
      }
    },
  });

  if (!state) return null;
  // What to say now, since there is no button to show it.
  const instruction = state.dead_end
    ? fr.voice.decouvreurDeadEnd
    : state.prompt === null
      ? fr.voice.decouvreurCharacter
      : fr.voice.decouvreurHint;
  return <VoicePanel turn={turn} enabled={enabled} instruction={instruction} testID="decouvreur-voice" />;
}

/**
 * The Tireur answers out loud. The word comes from the transcript, OUI versus the
 * held OUIIII from the sound; when the sound is borderline, the phone asks to say
 * it again rather than guess (a wrong branch is far worse than one more try).
 */
export function TireurVoice({ game, paused = false }: { game: UseGame; paused?: boolean }) {
  const { speak } = useSpeech();
  const settings = useVoiceSettings();
  const { state } = game;
  const prompt = state?.prompt ?? null;
  const pendingGuess = state?.pending_guess ?? null;
  const answering = state?.status === 'PLAYING' && ((state.awaiting === 'ANSWER' && prompt !== null) || pendingGuess !== null);
  // Same as the Découvreur: time up closes the microphone immediately.
  const enabled = Boolean(answering && !game.busy && !paused && game.countdown.level !== 'UP');

  const latest = useRef({ game, calibration: settings.calibration });
  latest.current = { game, calibration: settings.calibration };

  const turn = useVoiceTurn({
    enabled,
    hint: () => {
      const current = latest.current.game.state;
      return buildTranscribeHint(current?.pending_guess ?? current?.prompt?.text ?? null, []);
    },
    onTranscript: async (text, recording) => {
      const { game: now, calibration } = latest.current;
      const current = now.state;
      if (!current || current.status !== 'PLAYING') return;
      const guessing = current.pending_guess !== null;
      if (!guessing && (current.awaiting !== 'ANSWER' || !current.prompt)) return;

      const decision = interpretTireur({
        transcript: text,
        envelope: recording.envelope,
        calibration,
        answerClasses: guessing ? null : (current.prompt?.answer_classes ?? []),
      });
      if (decision.kind === 'ANSWER') {
        if (guessing) {
          const label = guessConfirmation(decision);
          if (label) await now.confirmGuess(label);
        } else {
          await now.answer(decision.label);
        }
        return;
      }
      if (decision.kind === 'CONFIRM') {
        turn.setNotice(fr.voice.sayAgain);
        speak(fr.voice.sayAgain);
        return;
      }
      if (decision.kind === 'REWIND' && decision.count <= current.path.length) {
        await now.rewind(decision.count);
        return;
      }
      turn.setNotice(fr.voice.notUnderstood);
      speak(fr.voice.notUnderstood);
    },
  });

  if (!state) return null;
  return (
    <VoicePanel
      turn={turn}
      enabled={enabled}
      instruction={pendingGuess ? fr.voice.guessHint : fr.voice.tireurHint}
      testID="tireur-voice"
    />
  );
}
