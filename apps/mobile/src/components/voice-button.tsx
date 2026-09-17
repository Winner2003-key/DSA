import React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { AppText } from './app-text';
import { Chip } from './buttons';
import { fr } from '@/i18n/fr';
import { lightFeedback } from '@/lib/haptics';
import type { CapturePhase } from '@/speech/use-voice-capture';
import { setTalkMode, type TalkMode } from '@/speech/voice-settings';
import { useTheme } from '@/theme';

export interface VoiceButtonProps {
  phase: CapturePhase;
  /** 0…1 while listening. */
  level: number;
  talkMode: TalkMode;
  disabled?: boolean;
  pressIn: () => void;
  pressOut: () => void;
  tap: () => void;
  /** The instruction under the button when ready; defaults to the talk mode's. */
  readyLabel?: string;
  testID?: string;
}

const BARS = 12;

/**
 * The microphone: a wide slab to hold (or tap), with its state in words — prêt,
 * écoute with a live level meter, analyse — so it reads without looking closely.
 */
export function VoiceButton({
  phase,
  level,
  talkMode,
  disabled = false,
  pressIn,
  pressOut,
  tap,
  readyLabel,
  testID = 'voice-button',
}: VoiceButtonProps) {
  const theme = useTheme();
  const listening = phase === 'listening' || phase === 'starting';
  const analysing = phase === 'processing';
  const hold = talkMode === 'HOLD';

  let label = readyLabel ?? (hold ? fr.voice.readyHold : fr.voice.readyFree);
  if (disabled) label = fr.voice.notYourTurn;
  if (listening) label = hold ? fr.voice.listening : fr.voice.listeningFree;
  if (analysing) label = fr.voice.analysing;

  const lit = Math.round(level * BARS);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${fr.voice.micLabel}. ${label}`}
      accessibilityState={{ disabled: disabled || analysing, busy: analysing }}
      disabled={disabled || analysing}
      onPressIn={
        hold
          ? () => {
              lightFeedback();
              pressIn();
            }
          : undefined
      }
      onPressOut={hold ? pressOut : undefined}
      onPress={
        hold
          ? undefined
          : () => {
              lightFeedback();
              tap();
            }
      }
      style={{ width: '100%', opacity: disabled ? 0.45 : 1 }}
    >
      <View
        testID={`${testID}-${disabled ? 'disabled' : phase}`}
        style={{
          minHeight: theme.touch.answer,
          borderRadius: theme.radius.slab,
          borderWidth: 3,
          borderColor: listening ? theme.colors.danger : theme.colors.brass,
          backgroundColor: listening ? theme.colors.surfaceRaised : theme.colors.surface,
          paddingHorizontal: theme.space.md,
          paddingVertical: theme.space.sm,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space.sm,
        }}
      >
        <AppText variant="title" accessibilityElementsHidden importantForAccessibility="no">
          {listening ? '🔴' : '🎙️'}
        </AppText>
        <View style={{ flex: 1, gap: theme.space.xxs }}>
          <AppText variant="lead" weight="bold" tight testID={`${testID}-label`}>
            {label}
          </AppText>
          {listening ? (
            <View testID="voice-level" style={{ flexDirection: 'row', gap: 3, height: 14, alignItems: 'flex-end' }}>
              {Array.from({ length: BARS }, (_, i) => (
                <View
                  key={i}
                  style={{
                    flex: 1,
                    height: 4 + (10 * (i + 1)) / BARS,
                    borderRadius: 2,
                    backgroundColor: i < lit ? theme.colors.brass : theme.colors.line,
                  }}
                />
              ))}
            </View>
          ) : null}
        </View>
        {analysing ? <ActivityIndicator color={theme.colors.brass} /> : null}
      </View>
    </Pressable>
  );
}

/** "Maintenir pour parler" / "Parler librement", saved on this device. */
export function TalkModeChips({ talkMode, disabled = false }: { talkMode: TalkMode; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs }}>
      <Chip
        testID="talk-mode-hold"
        label={fr.voice.holdToTalk}
        selected={talkMode === 'HOLD'}
        disabled={disabled}
        onPress={() => setTalkMode('HOLD')}
      />
      <Chip
        testID="talk-mode-free"
        label={fr.voice.freeTalk}
        selected={talkMode === 'FREE'}
        disabled={disabled}
        onPress={() => setTalkMode('FREE')}
      />
    </View>
  );
}
