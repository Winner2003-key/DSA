import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import type { AnswerClass } from '@dsa/core';
import { speakableName, speakablePrompt } from '@dsa/voice';

import { AnswerSlab, AppText, LinkButton, PathSheet, SecretCard } from '@/components';
import { fitVariant } from '@/components/fit-variant';
import { asQuestion, fr } from '@/i18n/fr';
import { warningFeedback } from '@/lib/haptics';
import { CANONICAL_LABEL } from '@/services/types';
import { useSpeech } from '@/speech/use-speech';
import { useSecret } from '@/state/use-secret';
import type { UseGame } from '@/state/use-game';
import { useTheme } from '@/theme';
import { CalibrationOffer, CalibrationSheet } from './calibration-panel';
import { TireurVoice, isVoiceGame } from './voice-play';
import { Route } from '@/components';

/** The book's own order, so the extra codes always sit in the same place. */
const EXTRA_ORDER: AnswerClass[] = ['OUI_REPETE', 'NON_REPETE', 'JE_NE_SAIS_PAS'];

export interface TireurViewProps {
  sessionId: string;
  game: UseGame;
}

/**
 * The Tireur holds the card and answers. The incoming question is the largest thing
 * on screen, the answer pad offers only what the book allows at that question, and
 * "QUESTION" (going back after a mistake) sits in its own zone, well away from the
 * answers. Buttons send the canonical book label, never raw text (§7).
 */
export function TireurView({ sessionId, game }: TireurViewProps) {
  const theme = useTheme();
  const { speak } = useSpeech();
  const { state, busy, aiThinking } = game;
  const { secret } = useSecret(sessionId, true);

  // On a shared phone the card starts face down; alone against the app, face up.
  const [revealed, setRevealed] = useState(state?.mode !== 'LOCAL');
  const [pathOpen, setPathOpen] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const voice = isVoiceGame(game);
  const spoken = useRef('');

  const prompt = state?.prompt ?? null;
  const pendingGuess = state?.pending_guess ?? null;
  const awaiting = state?.awaiting ?? 'NONE';

  useEffect(() => {
    if (state?.mode === 'LOCAL') setRevealed(false);
  }, [state?.mode]);

  // Read the question — or the name being called — out loud to the Tireur, as the
  // bare label in its speakable form: "Lié à Adam ?", never "Est-ce …" (§10).
  useEffect(() => {
    let utterance = '';
    if (pendingGuess) utterance = `${speakableName(pendingGuess)} ?`;
    else if (awaiting === 'ANSWER' && prompt) utterance = speakablePrompt(prompt.text);
    if (utterance && utterance !== spoken.current) {
      spoken.current = utterance;
      speak(utterance);
    }
  }, [awaiting, pendingGuess, prompt, speak]);

  if (!state) return null;

  const classes = prompt?.answer_classes ?? [];
  const main = (['OUI', 'NON'] as AnswerClass[]).filter((cls) => classes.includes(cls));
  const extras = EXTRA_ORDER.filter((cls) => classes.includes(cls));
  const canAnswer = awaiting === 'ANSWER' && prompt !== null && !busy;
  const canRewind = (awaiting === 'ANSWER' || awaiting === 'QUESTION') && state.path.length > 0 && !busy;

  const incoming = (label: string, text: string, testID: string) => (
    <View
      testID={testID}
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.card,
        borderLeftWidth: 6,
        borderLeftColor: theme.colors.brass,
        padding: theme.space.lg,
        gap: theme.space.xxs,
      }}
    >
      <AppText variant="lead" tone="soft">
        {label}
      </AppText>
      <AppText variant={fitVariant(text)} weight="bold" tight testID={`${testID}-text`}>
        {text}
      </AppText>
    </View>
  );

  return (
    <View style={{ flex: 1, gap: theme.space.md }}>
      <SecretCard secret={secret} revealed={revealed} onToggle={() => setRevealed((r) => !r)} />

      {voice ? <CalibrationOffer onCalibrate={() => setCalibrating(true)} /> : null}

      {pendingGuess ? (
        incoming(fr.tireur.calls, pendingGuess, 'incoming-guess')
      ) : awaiting === 'ANSWER' && prompt ? (
        incoming(fr.tireur.asks, asQuestion(prompt.text), 'incoming-question')
      ) : (
        <View
          testID="tireur-waiting"
          style={{ minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, paddingHorizontal: theme.space.xs }}
        >
          <ActivityIndicator color={theme.colors.brass} />
          <AppText variant="lead" tone="soft" style={{ flex: 1 }}>
            {aiThinking || state.mode === 'AI_DECOUVREUR' ? fr.tireur.waitingAi : fr.table.decouvreurThinking}
          </AppText>
        </View>
      )}

      {/* Mounted once for the whole game, so what was heard and a fallback survive between turns. */}
      {voice ? <TireurVoice game={game} paused={calibrating} /> : null}

      {pendingGuess ? (
        <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
          <AnswerSlab answerClass="OUI" half disabled={busy} testID="confirm-oui" onPress={() => void game.confirmGuess('OUI')} />
          <AnswerSlab answerClass="NON" half disabled={busy} testID="confirm-non" onPress={() => void game.confirmGuess('NON')} />
        </View>
      ) : awaiting === 'ANSWER' && prompt ? (
        <View testID="answer-pad" style={{ gap: theme.space.sm }}>
          {main.length > 0 ? (
            <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
              {main.map((cls) => (
                <AnswerSlab
                  key={cls}
                  answerClass={cls}
                  half={main.length > 1}
                  disabled={!canAnswer}
                  onPress={() => void game.answer(CANONICAL_LABEL[cls])}
                />
              ))}
            </View>
          ) : null}
          {extras.map((cls) => (
            <AnswerSlab key={cls} answerClass={cls} disabled={!canAnswer} onPress={() => void game.answer(CANONICAL_LABEL[cls])} />
          ))}
        </View>
      ) : null}

      {state.path.length > 0 ? (
        <LinkButton testID="see-path" icon={Route} label={fr.conversation.seePath} onPress={() => setPathOpen(true)} />
      ) : null}

      {/* A zone of its own: a mis-tap here undoes answers, so it is far from the pad. */}
      <View
        testID="rewind-zone"
        style={{
          marginTop: theme.space.xl,
          paddingTop: theme.space.lg,
          borderTopWidth: 1,
          borderTopColor: theme.colors.line,
          gap: theme.space.sm,
        }}
      >
        <View>
          <AppText variant="lead" weight="semibold">
            {fr.tireur.mistakeTitle}
          </AppText>
          <AppText variant="small" tone="soft">
            {fr.tireur.mistakeHint}
          </AppText>
        </View>
        <View style={{ flexDirection: 'row', gap: theme.space.xs }}>
          {([1, 2, 3] as const).map((count) => {
            // Since 0010 any of ×1/×2/×3 is allowed as soon as one answer exists:
            // asking for more lists than were opened goes back to the start.
            const disabled = !canRewind || state.path.length === 0;
            return (
              <Pressable
                key={count}
                testID={`rewind-${count}`}
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                accessibilityLabel={fr.tireur.rewindLabel(count)}
                accessibilityHint={fr.tireur.rewindExplain(count)}
                disabled={disabled}
                onPress={() => {
                  warningFeedback();
                  void game.rewind(count);
                }}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: theme.touch.secondary,
                  borderRadius: theme.radius.field,
                  borderWidth: 1,
                  borderColor: pressed ? theme.colors.danger : theme.colors.line,
                  backgroundColor: pressed ? theme.colors.surfaceRaised : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: disabled ? 0.4 : 1,
                })}
              >
                <AppText variant="micro" weight="semibold" tone="soft">
                  QUESTION
                </AppText>
                <AppText variant="lead" weight="bold">
                  ×{count}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <PathSheet visible={pathOpen} path={state.path} onClose={() => setPathOpen(false)} />
      {voice ? <CalibrationSheet visible={calibrating} onClose={() => setCalibrating(false)} /> : null}
    </View>
  );
}
