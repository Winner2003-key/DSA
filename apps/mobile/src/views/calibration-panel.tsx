import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { analyzeEnvelope, calibrate, type Calibration, type EnvelopeAnalysis } from '@dsa/voice';

import { AppText, LinkButton, NoticeBanner, PrimaryButton, SecondaryButton, Sheet, TalkModeChips, VoiceButton } from '@/components';
import { fr } from '@/i18n/fr';
import { soundVerdict } from '@/speech/interpret';
import type { RecorderErrorCode, Recording } from '@/speech/recorder-types';
import { useSpeech } from '@/speech/use-speech';
import { useVoiceCapture } from '@/speech/use-voice-capture';
import { MIN_RECORDING_MS } from '@/speech/use-voice-turn';
import { markCalibrationOffered, saveCalibration, useVoiceSettings } from '@/speech/voice-settings';
import { useTheme } from '@/theme';
import { Check, Mic, RotateCcw } from '@/components';

/** Two takes of each sound (the brief); the median of two is their mean. */
export const TAKES_PER_SOUND = 2;

type Step = { kind: 'INTRO' } | { kind: 'TAKE'; sound: 'SHORT' | 'LONG'; take: number } | { kind: 'RESULT' };

function nextStep(step: Step): Step {
  if (step.kind === 'INTRO') return { kind: 'TAKE', sound: 'SHORT', take: 1 };
  if (step.kind === 'TAKE') {
    if (step.take < TAKES_PER_SOUND) return { ...step, take: step.take + 1 };
    if (step.sound === 'SHORT') return { kind: 'TAKE', sound: 'LONG', take: 1 };
  }
  return { kind: 'RESULT' };
}

const seconds = (ms: number) => fr.voice.seconds(ms);

/** "OUI 0,3 s · OUIIII 1,1 s · above 0,7 s it's OUI OUI OUI", kept simple. */
export function CalibrationSummary({ calibration }: { calibration: Calibration }) {
  const theme = useTheme();
  return (
    <View testID="calibration-summary" style={{ gap: theme.space.xxs }}>
      <AppText variant="body">{fr.voice.shortMeasure(seconds(calibration.shortMedianMs))}</AppText>
      <AppText variant="body">{fr.voice.longMeasure(seconds(calibration.longMedianMs))}</AppText>
      <AppText variant="body" weight="semibold">
        {fr.voice.thresholdMeasure(seconds(calibration.thresholdMs))}
      </AppText>
      {calibration.quality === 'weak' ? (
        <AppText variant="small" tone="danger" testID="calibration-weak">
          {fr.voice.resultWeak}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * GRAPH_SPECIFICATION §1 calibration: "Dis OUI normalement" ×2, "Dis OUIIII en le
 * tenant longtemps" ×2, then a live test ("Dis l'un ou l'autre" → "J'ai compris :
 * OUI OUI OUI"). Only the sound is used — nothing is sent to the server — and the
 * result is stored on this device.
 */
export function CalibrationPanel({
  onDone,
  startImmediately = false,
  showTalkMode = true,
}: {
  onDone?: () => void;
  startImmediately?: boolean;
  /** The settings screen already shows the talk mode above the panel. */
  showTalkMode?: boolean;
}) {
  const theme = useTheme();
  const { speak } = useSpeech();
  const settings = useVoiceSettings();
  const [step, setStep] = useState<Step>(startImmediately ? { kind: 'TAKE', sound: 'SHORT', take: 1 } : { kind: 'INTRO' });
  const [notice, setNotice] = useState<string | null>(null);
  const [understood, setUnderstood] = useState<string | null>(null);
  const [micError, setMicError] = useState<RecorderErrorCode | null>(null);
  const takes = useRef<{ SHORT: EnvelopeAnalysis[]; LONG: EnvelopeAnalysis[] }>({ SHORT: [], LONG: [] });
  const stepRef = useRef(step);
  stepRef.current = step;

  const instruction =
    step.kind === 'TAKE' ? (step.sound === 'SHORT' ? fr.voice.sayShort : fr.voice.sayLong) : step.kind === 'RESULT' ? fr.voice.liveTest : null;

  // Said out loud as well: the game is heard before it is read.
  useEffect(() => {
    if (instruction && step.kind === 'TAKE' && step.take === 1) speak(instruction);
  }, [instruction, speak, step]);

  const onRecording = (recording: Recording) => {
    setNotice(null);
    const current = stepRef.current;
    if (recording.durationMs < MIN_RECORDING_MS) {
      setNotice(fr.voice.tooShort);
      return;
    }
    if (current.kind === 'RESULT') {
      const calibration = settings.calibration;
      if (!calibration) return;
      const verdict = soundVerdict(recording.envelope, calibration);
      if (verdict === 'NO_SOUND') setNotice(fr.voice.nothingHeard);
      else if (verdict === 'REPEATED') setUnderstood(fr.voice.understood(fr.answers.OUI_REPETE));
      else if (verdict === 'SIMPLE') setUnderstood(fr.voice.understood(fr.answers.OUI));
      else setUnderstood(fr.voice.understoodBorderline);
      return;
    }
    if (current.kind !== 'TAKE') return;
    const analysis = analyzeEnvelope(recording.envelope);
    if (analysis.bursts === 0) {
      setNotice(fr.voice.nothingHeard);
      return;
    }
    takes.current[current.sound].push(analysis);
    const next = nextStep(current);
    if (next.kind === 'RESULT') {
      saveCalibration(calibrate(takes.current.SHORT, takes.current.LONG));
      setUnderstood(null);
    }
    setStep(next);
  };

  const capture = useVoiceCapture({
    enabled: step.kind !== 'INTRO' && micError === null,
    talkMode: settings.talkMode,
    onRecording,
    onRecorderError: setMicError,
  });

  const restart = () => {
    takes.current = { SHORT: [], LONG: [] };
    setNotice(null);
    setUnderstood(null);
    setStep({ kind: 'TAKE', sound: 'SHORT', take: 1 });
  };

  if (micError !== null || !capture.supported) {
    return (
      <NoticeBanner
        testID="calibration-mic-error"
        tone="warn"
        title={micError === 'PERMISSION_DENIED' ? fr.voice.micDenied : micError === 'FAILED' ? fr.voice.micFailed : fr.voice.micUnavailable}
      >
        {micError === 'FAILED' ? <SecondaryButton icon={RotateCcw} label={fr.app.retry} onPress={() => setMicError(null)} /> : null}
      </NoticeBanner>
    );
  }

  if (step.kind === 'INTRO') {
    return (
      <View testID="calibration-intro" style={{ gap: theme.space.sm }}>
        <AppText variant="body" tone="soft">
          {fr.voice.calibrationIntro}
        </AppText>
        <PrimaryButton testID="calibration-start" icon={Mic} label={fr.voice.calibrateStart} onPress={() => setStep(nextStep(step))} />
      </View>
    );
  }

  const button = (
    <>
      <VoiceButton
        testID="calibration-voice"
        phase={capture.phase}
        level={capture.level}
        talkMode={settings.talkMode}
        pressIn={capture.pressIn}
        pressOut={capture.pressOut}
        tap={capture.tap}
      />
      {notice ? (
        <AppText variant="body" tone="danger" testID="calibration-notice">
          {notice}
        </AppText>
      ) : null}
      {showTalkMode ? <TalkModeChips talkMode={settings.talkMode} disabled={capture.phase !== 'idle'} /> : null}
    </>
  );

  if (step.kind === 'TAKE') {
    return (
      <View testID="calibration-take" style={{ gap: theme.space.sm }}>
        <AppText variant="small" weight="semibold" tone="brass" testID="calibration-take-count">
          {fr.voice.take(step.take, TAKES_PER_SOUND)}
        </AppText>
        <AppText variant="display" weight="bold" tight testID="calibration-instruction">
          {instruction}
        </AppText>
        {button}
      </View>
    );
  }

  return (
    <View testID="calibration-result" style={{ gap: theme.space.sm }}>
      <AppText variant="title" weight="bold" tight>
        {fr.voice.resultTitle}
      </AppText>
      {settings.calibration ? <CalibrationSummary calibration={settings.calibration} /> : null}
      <View style={{ gap: theme.space.xs, paddingTop: theme.space.sm }}>
        <AppText variant="lead" weight="semibold">
          {fr.voice.liveTest}
        </AppText>
        <AppText variant="small" tone="soft">
          {fr.voice.liveTestHint}
        </AppText>
        {button}
        {understood ? (
          <AppText variant="title" weight="bold" testID="calibration-understood">
            {understood}
          </AppText>
        ) : null}
      </View>
      <PrimaryButton testID="calibration-done" icon={Check} label={fr.voice.done} onPress={() => onDone?.()} />
      <LinkButton testID="calibration-again" label={fr.voice.calibrateAgain} onPress={restart} />
    </View>
  );
}

/** The calibration over the game, so a room or an AI game keeps running underneath. */
export function CalibrationSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} title={fr.voice.calibrationTitle} onClose={onClose} testID="calibration-sheet">
      {visible ? <CalibrationPanel onDone={onClose} /> : null}
    </Sheet>
  );
}

/**
 * Offered the first time someone plays Tireur with Voix, or — on a shared phone
 * (LOCAL) — every time, "Calibrer pour ce Tireur", since the Tireur may be someone else.
 */
export function CalibrationOffer({ local = false, onCalibrate }: { local?: boolean; onCalibrate: () => void }) {
  const theme = useTheme();
  const settings = useVoiceSettings();
  if (!settings.loaded) return null;
  if (local) {
    return (
      <View testID="calibration-offer-local" style={{ gap: theme.space.xxs }}>
        <SecondaryButton testID="calibrate-for-tireur" icon={Mic} label={fr.voice.calibrateForTireur} onPress={onCalibrate} />
        <AppText variant="small" tone="soft">
          {fr.voice.calibrateForTireurHint}
        </AppText>
      </View>
    );
  }
  if (settings.calibration || settings.calibrationOffered) return null;
  return (
    <NoticeBanner testID="calibration-offer" title={fr.voice.offerTitle} hint={fr.voice.offerHint}>
      <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
        <SecondaryButton
          testID="calibration-offer-later"
          label={fr.voice.offerLater}
          onPress={markCalibrationOffered}
          style={{ flex: 1, width: undefined }}
        />
        <PrimaryButton
          testID="calibration-offer-accept"
          icon={Mic}
          label={fr.voice.calibrate}
          onPress={() => {
            markCalibrationOffered();
            onCalibrate();
          }}
          style={{ flex: 1, width: undefined }}
        />
      </View>
    </NoticeBanner>
  );
}
