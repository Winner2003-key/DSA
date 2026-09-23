import React, { useMemo, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { AppText } from './app-text';
import { ChevronUp, ICON_STROKE, Lock, Mic, Send } from './icon';
import { fr } from '@/i18n/fr';
import { lightFeedback } from '@/lib/haptics';
import type { CapturePhase } from '@/speech/use-voice-capture';
import { useTheme } from '@/theme';

export interface VoiceButtonProps {
  phase: CapturePhase;
  /** 0…1 while listening. */
  level: number;
  /** Slid up while holding: the recording goes on until the microphone is touched. */
  locked: boolean;
  disabled?: boolean;
  pressIn: () => void;
  pressOut: () => void;
  lock: () => void;
  tap: () => void;
  /** The instruction above the microphone when ready. */
  readyLabel?: string;
  testID?: string;
}

const BARS = 12;
const SIZE = 96;
/** How far up the finger slides, in points, to lock the recording. */
export const LOCK_DISTANCE = 60;

/**
 * The microphone, as a voice note in a messaging app: hold it and talk, let go to
 * send. Slide up while holding and it locks — keep talking hands free, then touch
 * it once to send. Its state is written above it (prêt, écoute, bloqué, analyse),
 * so it reads without looking closely.
 *
 * A screen reader cannot hold and slide: its "activate" starts a locked
 * recording, and a second one sends it.
 */
export function VoiceButton({
  phase,
  level,
  locked,
  disabled = false,
  pressIn,
  pressOut,
  lock,
  tap,
  readyLabel,
  testID = 'voice-button',
}: VoiceButtonProps) {
  const theme = useTheme();
  const listening = phase === 'listening' || phase === 'starting';
  const analysing = phase === 'processing';
  const blocked = disabled || analysing;

  let label = readyLabel ?? fr.voice.ready;
  if (disabled) label = fr.voice.notYourTurn;
  if (listening) label = locked ? fr.voice.locked : fr.voice.listening;
  if (analysing) label = fr.voice.analysing;

  // Read inside the gesture's callbacks, which are built once per render.
  const latest = useRef({ locked, pressIn, pressOut, lock, tap });
  latest.current = { locked, pressIn, pressOut, lock, tap };
  const holding = useRef(false);
  const lockedDuringHold = useRef(false);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .withTestId(testID)
        .runOnJS(true)
        .enabled(!blocked)
        .minDistance(0)
        .shouldCancelWhenOutside(false)
        .onBegin(() => {
          // A locked recording: this touch is the "send".
          if (latest.current.locked) {
            holding.current = false;
            latest.current.tap();
            return;
          }
          lightFeedback();
          holding.current = true;
          lockedDuringHold.current = false;
          latest.current.pressIn();
        })
        .onUpdate((event) => {
          if (!holding.current || lockedDuringHold.current || event.translationY > -LOCK_DISTANCE) return;
          lockedDuringHold.current = true;
          lightFeedback();
          latest.current.lock();
        })
        .onFinalize(() => {
          if (!holding.current) return;
          holding.current = false;
          latest.current.pressOut();
        }),
    [blocked, testID],
  );

  const lit = Math.round(level * BARS);
  const ring = listening ? theme.colors.danger : theme.colors.brass;
  const MicIcon = locked && listening ? Send : Mic;

  return (
    <View style={{ width: '100%', alignItems: 'center', gap: theme.space.sm, opacity: disabled ? 0.45 : 1 }}>
      {/* The hint sits on top: the thumb covers whatever is under the button. */}
      <AppText variant="lead" weight="bold" tight testID={`${testID}-label`} style={{ textAlign: 'center' }}>
        {label}
      </AppText>

      {/* While held and not yet locked: where to slide. */}
      <View style={{ height: 40, alignItems: 'center', justifyContent: 'flex-end' }}>
        {listening && !locked ? (
          <View testID={`${testID}-slide`} accessibilityLabel={fr.voice.slideToLock} style={{ alignItems: 'center' }}>
            <Lock size={18} color={theme.colors.inkSoft} strokeWidth={ICON_STROKE} />
            <ChevronUp size={18} color={theme.colors.inkSoft} strokeWidth={ICON_STROKE} />
          </View>
        ) : null}
        {listening && locked ? (
          <View testID={`${testID}-locked`}>
            <Lock size={22} color={theme.colors.danger} strokeWidth={ICON_STROKE} />
          </View>
        ) : null}
      </View>

      <GestureDetector gesture={gesture}>
        <View
          testID={testID}
          collapsable={false}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`${fr.voice.micLabel}. ${label}`}
          accessibilityState={{ disabled: blocked, busy: analysing }}
          accessibilityActions={[{ name: 'activate' }]}
          onAccessibilityAction={(event) => {
            if (!blocked && event.nativeEvent.actionName === 'activate') latest.current.tap();
          }}
          hitSlop={16}
        >
          <View
            testID={`${testID}-${disabled ? 'disabled' : phase}`}
            style={{
              width: SIZE,
              height: SIZE,
              borderRadius: SIZE / 2,
              borderWidth: 4,
              borderColor: ring,
              backgroundColor: listening ? theme.colors.danger : theme.colors.surfaceRaised,
              alignItems: 'center',
              justifyContent: 'center',
              transform: [{ scale: listening && !locked ? 1.12 : 1 }],
            }}
          >
            {analysing ? (
              <ActivityIndicator color={theme.colors.brass} />
            ) : (
              <MicIcon size={40} color={listening ? theme.colors.surface : theme.colors.brass} strokeWidth={ICON_STROKE} />
            )}
          </View>
        </View>
      </GestureDetector>

      <View testID={listening ? 'voice-level' : undefined} style={{ flexDirection: 'row', gap: 3, height: 14, width: 160, alignItems: 'flex-end' }}>
        {listening
          ? Array.from({ length: BARS }, (_, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: 4 + (10 * (i + 1)) / BARS,
                  borderRadius: 2,
                  backgroundColor: i < lit ? theme.colors.brass : theme.colors.line,
                }}
              />
            ))
          : null}
      </View>
    </View>
  );
}
