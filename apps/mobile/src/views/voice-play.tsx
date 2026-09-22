import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { answerClass } from '@dsa/core';
import { buildTranscribeHint } from '@dsa/voice';

import { AnswerSlab, AppText, NoticeBanner, SecondaryButton, TalkModeChips, VoiceButton } from '@/components';
import { fr } from '@/i18n/fr';
import { guessConfirmation, interpretDecouvreur, interpretTireur, type CanonicalLabel } from '@/speech/interpret';
import { useSpeech } from '@/speech/use-speech';
import { useVoiceTurn, type VoiceTurn } from '@/speech/use-voice-turn';
import { useVoiceSettings } from '@/speech/voice-settings';
import type { UseGame } from '@/state/use-game';
import { useTheme } from '@/theme';

/** Voice was chosen for this game ("Façon de jouer : Voix"). */
export function isVoiceGame(game: UseGame): boolean {
  return game.state?.settings?.input_mode === 'VOICE';
}

/**
 * The microphone block of a game screen: the fallback banner (the buttons keep
 * working), the talk button with its live state, what was heard, and the talk mode.
 */
function VoicePanel({ turn, enabled, instruction, testID }: { turn: VoiceTurn; enabled: boolean; instruction: string; testID: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ gap: theme.space.xs }}>
      {turn.fallback ? (
        <NoticeBanner testID="voice-fallback" tone="warn" title={turn.fallback} hint={fr.voice.useButtons}>
          <SecondaryButton testID="voice-fallback-close" label={fr.app.close} onPress={turn.dismissFallback} />
        </NoticeBanner>
      ) : null}
      {turn.off ? null : (
        <>
          <VoiceButton
            phase={turn.phase}
            level={turn.level}
            talkMode={turn.talkMode}
            disabled={!enabled}
            pressIn={turn.pressIn}
            pressOut={turn.pressOut}
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
          <TalkModeChips talkMode={turn.talkMode} disabled={turn.phase !== 'idle'} />
        </>
      )}
    </View>
  );
}

export interface DecouvreurVoiceProps {
  game: UseGame;
  names: string[];
  /** "Revenir" without a recognisable question: let the player pick it. */
  onChooseStep: () => void;
}

/**
 * The Découvreur speaks: "Ancien ?" asks, "Absalom !" calls a name, "revenir à
 * Pentateuque" goes back. The same `useGame` actions as the buttons.
 */
export function DecouvreurVoice({ game, names, onChooseStep }: DecouvreurVoiceProps) {
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
          if (action.stepIndex === null) onChooseStep();
          else await now.goBack(action.stepIndex);
          return;
        default:
          turn.setNotice(fr.voice.notUnderstood);
          speak(fr.voice.notUnderstood);
      }
    },
  });

  if (!state) return null;
  return <VoicePanel turn={turn} enabled={enabled} instruction={fr.voice.decouvreurHint} testID="decouvreur-voice" />;
}

/**
 * The Tireur answers out loud. The word comes from the transcript, OUI versus the
 * held OUIIII from the sound; when the sound is borderline, two big buttons ask
 * (a wrong branch is far worse than one extra tap). The answer pad stays visible.
 */
export function TireurVoice({ game, paused = false }: { game: UseGame; paused?: boolean }) {
  const theme = useTheme();
  const { speak } = useSpeech();
  const settings = useVoiceSettings();
  const { state } = game;
  const prompt = state?.prompt ?? null;
  const pendingGuess = state?.pending_guess ?? null;
  const answering = state?.status === 'PLAYING' && ((state.awaiting === 'ANSWER' && prompt !== null) || pendingGuess !== null);
  // Same as the Découvreur: time up closes the microphone immediately.
  const enabled = Boolean(answering && !game.busy && !paused && game.countdown.level !== 'UP');

  const [confirm, setConfirm] = useState<[CanonicalLabel, CanonicalLabel] | null>(null);
  const questionKey = `${state?.path.length ?? 0}:${prompt?.node_id ?? ''}:${pendingGuess ?? ''}:${state?.awaiting ?? ''}`;
  useEffect(() => setConfirm(null), [questionKey]);

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
        setConfirm(decision.options);
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
    <View style={{ gap: theme.space.sm }}>
      {confirm && answering ? (
        <View
          testID="voice-confirm"
          style={{
            gap: theme.space.sm,
            padding: theme.space.md,
            borderRadius: theme.radius.card,
            borderWidth: 2,
            borderColor: theme.colors.brass,
            backgroundColor: theme.colors.surfaceRaised,
          }}
        >
          <AppText variant="title" weight="bold" tight>
            {fr.voice.confirmTitle}
          </AppText>
          <AppText variant="small" tone="soft">
            {fr.voice.confirmHint}
          </AppText>
          {/* Full width, stacked: "NON NON NON" must read in full. */}
          <View style={{ gap: theme.space.sm }}>
            {confirm.map((label) => (
              <AnswerSlab
                key={label}
                answerClass={answerClass(label)}
                disabled={game.busy}
                testID={`voice-confirm-${answerClass(label)}`}
                onPress={() => {
                  setConfirm(null);
                  void game.answer(label);
                }}
              />
            ))}
          </View>
        </View>
      ) : null}
      <VoicePanel
        turn={turn}
        enabled={enabled}
        instruction={pendingGuess ? fr.voice.guessHint : fr.voice.tireurHint}
        testID="tireur-voice"
      />
    </View>
  );
}
