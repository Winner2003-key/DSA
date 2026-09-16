import React, { useRef } from 'react';
import { ScrollView, View } from 'react-native';

import { AnswerStamp } from './answer-stamp';
import { AppText } from './app-text';
import { fitVariant } from './fit-variant';
import { asQuestion, fr } from '@/i18n/fr';
import type { Exchange } from '@/state/exchanges';
import { useTheme } from '@/theme';

/** What the Découvreur said, as written in the exchange. */
function said(exchange: Exchange): { label: string; text: string } {
  return exchange.kind === 'QUESTION'
    ? { label: fr.conversation.youAsked, text: asQuestion(exchange.text) }
    : { label: fr.conversation.youCalled, text: exchange.name };
}

export interface ExchangePairProps {
  exchange: Exchange;
  /** The Tireur's answer just arrived: stamp it in. */
  fresh?: boolean;
  testID?: string;
}

/**
 * The latest exchange, as two turns of a conversation: the Découvreur's question on
 * the left, the Tireur's answer on the right in the book's answer colour. Both come
 * from the same `Exchange`, so they can never belong to different questions.
 */
export function ExchangePair({ exchange, fresh = false, testID }: ExchangePairProps) {
  const theme = useTheme();
  const { label, text } = said(exchange);

  return (
    <View testID={testID} style={{ gap: theme.space.xs }}>
      <View
        testID={testID ? `${testID}-asked` : undefined}
        style={{
          alignSelf: 'flex-start',
          maxWidth: '88%',
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.card,
          borderBottomLeftRadius: 6,
          paddingHorizontal: theme.space.lg,
          paddingVertical: theme.space.sm,
        }}
      >
        <AppText variant="small" tone="soft">
          {label}
        </AppText>
        <AppText variant={fitVariant(text, 'display') === 'display' ? 'title' : 'lead'} weight="bold" tight>
          {text}
        </AppText>
      </View>
      <View style={{ alignSelf: 'flex-end', alignItems: 'flex-end', gap: 2 }}>
        <AppText variant="micro" tone="faint" style={{ marginRight: theme.space.xs }}>
          {fr.conversation.tireurSays}
        </AppText>
        <AnswerStamp
          key={exchange.key}
          answerLabel={exchange.answerLabel}
          size="bubble"
          stampIn={fresh}
          testID={testID ? `${testID}-answer` : undefined}
        />
      </View>
    </View>
  );
}

export interface EarlierExchangesProps {
  exchanges: Exchange[];
  testID?: string;
}

/**
 * Everything before the latest exchange, newest at the bottom, fading as it gets
 * older. It scrolls on its own so the current turn stays on screen.
 */
export function EarlierExchanges({ exchanges, testID = 'earlier-exchanges' }: EarlierExchangesProps) {
  const theme = useTheme();
  const scroll = useRef<ScrollView>(null);
  if (exchanges.length === 0) return null;

  return (
    <View>
      <AppText variant="micro" weight="semibold" tone="faint" style={{ marginBottom: 2 }}>
        {fr.conversation.earlier}
      </AppText>
      <ScrollView
        ref={scroll}
        testID={testID}
        style={{ maxHeight: 176 }}
        nestedScrollEnabled
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      >
        {exchanges.map((exchange, i) => {
          const age = exchanges.length - 1 - i;
          const { text } = said(exchange);
          return (
            <View
              key={exchange.key}
              testID={`exchange-${i}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space.sm,
                minHeight: 34,
                paddingVertical: 3,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.line,
                opacity: age >= 3 ? 0.55 : age >= 1 ? 0.75 : 0.9,
              }}
            >
              <AppText
                variant={age >= 3 ? 'micro' : 'small'}
                weight="medium"
                tone={exchange.kind === 'GUESS' ? 'brass' : 'ink'}
                numberOfLines={1}
                style={{ flex: 1 }}
              >
                {exchange.kind === 'GUESS' ? `${fr.conversation.youCalled} : ${text}` : text}
              </AppText>
              <AnswerStamp answerLabel={exchange.answerLabel} />
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
