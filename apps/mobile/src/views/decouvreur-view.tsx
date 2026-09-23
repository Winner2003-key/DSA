import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { speakableAnswer, speakablePrompt } from '@dsa/voice';

import {
  AppText,
  EarlierExchanges,
  ExchangePair,
  LinkButton,
  NamePad,
  NoticeBanner,
  PathSheet,
  PrimaryButton,
  SecondaryButton,
  StepPicker,
} from '@/components';
import { fitVariant } from '@/components/fit-variant';
import { asQuestion, fr } from '@/i18n/fr';
import { tapFeedback } from '@/lib/haptics';
import { useNames } from '@/state/use-names';
import type { UseGame } from '@/state/use-game';
import { useSpeech } from '@/speech/use-speech';
import { useTheme } from '@/theme';
import { DecouvreurVoice, isVoiceGame } from './voice-play';
import { Route, Undo2, UserPen } from '@/components';

export interface DecouvreurViewProps {
  game: UseGame;
}

/**
 * The Découvreur's side of the table, as a conversation (GRAPH_SPECIFICATION §8):
 *
 *   earlier exchanges            (small, fading, scrollable)
 *   Tu as demandé : LIE A ABRAHAM ?
 *                          NON   (the Tireur's answer to that question)
 *   ┌ Question suivante ─────────────┐
 *   │ SES ENFANTS ?                  │  a separate card for what comes next
 *   │ [ Poser la question ]          │
 *   └────────────────────────────────┘
 *
 * Every answer on screen is drawn from the same exchange as its question, and the
 * next question lives only in its own card, so "SES ENFANTS ? → NON" can't be read.
 * This view renders `prompt`, `path` and the refused calls, and never reads the secret.
 */
export function DecouvreurView({ game }: DecouvreurViewProps) {
  const theme = useTheme();
  const { speak } = useSpeech();
  const { names } = useNames();
  const { state, busy, exchanges, outgoing, rewoundTo } = game;

  const [namePadOpen, setNamePadOpen] = useState(false);
  const [stepPickerOpen, setStepPickerOpen] = useState(false);
  const [pathOpen, setPathOpen] = useState(false);

  const latest = exchanges.length > 0 ? exchanges[exchanges.length - 1] : undefined;
  const earlier = exchanges.slice(0, -1);

  // A new latest exchange after the first render is an answer that just arrived.
  const seenKey = useRef<string | null | undefined>(undefined);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  useEffect(() => {
    const key = latest?.key ?? null;
    if (seenKey.current !== undefined && key !== null && key !== seenKey.current) {
      setFreshKey(key);
      tapFeedback();
    }
    seenKey.current = key;
  }, [latest?.key]);

  const prompt = state?.prompt ?? null;
  const awaiting = state?.awaiting ?? 'NONE';
  const status = state?.status ?? 'PLAYING';
  const deadEnd = state?.dead_end ?? false;
  const pendingGuess = state?.pending_guess ?? null;

  const voice = isVoiceGame(game);

  // The answer, then what comes next, as one utterance: this game is heard before it is read.
  // With Voix the Découvreur says the questions, so the phone only answers — like the
  // person across the table ("Ancien ?" → "Oui.").
  const spoken = useRef('');
  useEffect(() => {
    if (status !== 'PLAYING' || awaiting !== 'QUESTION' || outgoing) return;
    const parts: string[] = [];
    if (latest && freshKey === latest.key) {
      const word = speakableAnswer(latest.answerLabel);
      if (word) parts.push(word);
    }
    if (prompt && !voice) parts.push(speakablePrompt(prompt.text));
    else if (deadEnd) parts.push(fr.spoken.deadEnd);
    const utterance = parts.join(' ');
    // Keyed by the exchange too: two answers in a row can be the same "Oui.".
    const said = `${latest && freshKey === latest.key ? latest.key : ''}|${utterance}`;
    if (utterance !== '' && said !== spoken.current) {
      spoken.current = said;
      speak(utterance);
    }
  }, [awaiting, deadEnd, freshKey, latest, outgoing, prompt, speak, status, voice]);

  if (!state) return null;

  // What the Découvreur is waiting to hear about, if anything.
  const waitingQuestion =
    outgoing?.kind === 'ASK' ? outgoing.text : awaiting === 'ANSWER' && prompt ? prompt.text : null;
  const waitingName = outgoing?.kind === 'GUESS' ? outgoing.name : awaiting === 'GUESS_CONFIRM' ? pendingGuess : null;
  const myTurn = status === 'PLAYING' && awaiting === 'QUESTION' && !outgoing;

  // A rewind that went all the way back leaves the path empty: the notice then
  // says "tout reprendre" rather than naming the first question twice.
  const justRewoundToStart = rewoundTo !== null && state.path.length === 0;
  const canAct = myTurn && !busy;
  const canGoBack = canAct && state.path.length > 0;
  const atCharacter = myTurn && prompt === null && !deadEnd;

  const secondary = (primaryIsGoBack: boolean) => (
    <View style={{ flexDirection: 'row', gap: theme.space.xs }}>
      <SecondaryButton
        testID="propose-name"
        style={{ flex: 1, width: undefined }}
        icon={UserPen}
        label={fr.game.proposeName}
        disabled={!canAct}
        onPress={() => setNamePadOpen(true)}
      />
      {primaryIsGoBack ? null : (
        <SecondaryButton
          testID="go-back"
          style={{ flex: 1, width: undefined }}
          icon={Undo2}
          label={fr.game.goBack}
          disabled={!canGoBack}
          onPress={() => setStepPickerOpen(true)}
        />
      )}
    </View>
  );

  const card = (accent: string, testID: string, children: React.ReactNode) => (
    <View
      testID={testID}
      style={{
        backgroundColor: theme.colors.surfaceRaised,
        borderRadius: theme.radius.card,
        borderWidth: 1,
        borderColor: accent,
        padding: theme.space.lg,
        gap: theme.space.sm,
      }}
    >
      {children}
    </View>
  );

  let turnCard: React.ReactNode = null;
  if (waitingQuestion !== null || waitingName !== null) {
    const asked = waitingQuestion !== null ? asQuestion(waitingQuestion) : (waitingName ?? '');
    turnCard = card(
      theme.colors.line,
      'waiting-card',
      <>
        <AppText variant="small" tone="soft">
          {waitingQuestion !== null ? fr.conversation.youAsked : fr.conversation.youCalled}
        </AppText>
        <AppText variant={fitVariant(asked, 'display')} weight="bold" tight testID="waiting-text">
          {asked}
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
          <ActivityIndicator color={theme.colors.brass} />
          <AppText variant="lead" tone="soft">
            {fr.conversation.waiting}
          </AppText>
        </View>
      </>,
    );
  } else if (myTurn && prompt) {
    turnCard = card(
      theme.colors.brass,
      'next-question',
      <>
        <AppText variant="small" weight="semibold" tone="brass">
          {state.path.length === 0 && !latest ? fr.conversation.firstQuestion : fr.conversation.nextQuestion}
        </AppText>
        <AppText variant={fitVariant(asQuestion(prompt.text))} weight="bold" tight testID="prompt-text">
          {asQuestion(prompt.text)}
        </AppText>
        <PrimaryButton testID="ask-button" label={fr.game.ask} disabled={!canAct} onPress={() => void game.ask()} />
        {secondary(false)}
      </>,
    );
  } else if (myTurn && deadEnd) {
    turnCard = card(
      theme.colors.danger,
      'dead-end',
      <>
        <AppText variant="title" weight="bold" tight>
          {fr.conversation.deadEnd}
        </AppText>
        <AppText variant="body" tone="soft">
          {fr.conversation.deadEndHint}
        </AppText>
        <PrimaryButton
          testID="go-back"
          icon={Undo2}
          label={fr.game.goBack}
          disabled={!canGoBack}
          onPress={() => setStepPickerOpen(true)}
        />
        {secondary(true)}
      </>,
    );
  } else if (atCharacter) {
    turnCard = card(
      theme.colors.brass,
      'character-reached',
      <>
        <AppText variant="title" weight="bold" tight>
          {fr.conversation.characterReached}
        </AppText>
        <AppText variant="body" tone="soft">
          {fr.conversation.characterReachedHint}
        </AppText>
        <PrimaryButton testID="propose-name" icon={UserPen} label={fr.game.proposeName} disabled={!canAct} onPress={() => setNamePadOpen(true)} />
        <SecondaryButton
          testID="go-back"
          icon={Undo2}
          label={fr.game.goBack}
          disabled={!canGoBack}
          onPress={() => setStepPickerOpen(true)}
        />
      </>,
    );
  }

  return (
    <View style={{ flex: 1, gap: theme.space.md }}>
      {rewoundTo !== null ? (
        <NoticeBanner
          testID="rewound-to"
          title={justRewoundToStart ? fr.game.rewoundToStart : fr.game.rewoundTo(asQuestion(rewoundTo))}
        />
      ) : null}

      <EarlierExchanges exchanges={earlier} />

      {latest ? (
        <ExchangePair
          exchange={latest}
          fresh={freshKey === latest.key || (seenKey.current !== undefined && seenKey.current !== latest.key)}
          testID="exchange-latest"
        />
      ) : null}

      {turnCard}

      {voice ? <DecouvreurVoice game={game} names={names} onChooseStep={() => setStepPickerOpen(true)} /> : null}

      {state.path.length > 0 ? (
        <LinkButton testID="see-path" icon={Route} label={fr.conversation.seePath} onPress={() => setPathOpen(true)} />
      ) : null}

      <NamePad
        visible={namePadOpen}
        names={names}
        onClose={() => setNamePadOpen(false)}
        onSubmit={(name) => {
          setNamePadOpen(false);
          void game.guess(name);
        }}
      />
      <StepPicker
        visible={stepPickerOpen}
        path={state.path}
        onClose={() => setStepPickerOpen(false)}
        onSelect={(stepIndex) => {
          setStepPickerOpen(false);
          void game.goBack(stepIndex);
        }}
      />
      <PathSheet visible={pathOpen} path={state.path} onClose={() => setPathOpen(false)} />
    </View>
  );
}
