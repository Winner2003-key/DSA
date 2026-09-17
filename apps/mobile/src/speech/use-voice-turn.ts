/**
 * One spoken turn in a game: record (useVoiceCapture) → `transcribe` → hand the
 * words to the view, which decides what they mean. Owns the French states the
 * player sees (prêt, écoute, analyse, "J'ai entendu : « … »") and the fallbacks:
 * whatever goes wrong, a banner explains it and the buttons keep working.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { TranscribeError } from '@dsa/voice';

import { fr } from '@/i18n/fr';
import type { Recording, RecorderErrorCode } from './recorder-types';
import { getTranscriber } from './transcriber';
import { useVoiceCapture, type CapturePhase } from './use-voice-capture';
import { useVoiceSettings, type TalkMode } from './voice-settings';

/** A hold shorter than this is a slip of the finger, not a word: nothing is sent. */
export const MIN_RECORDING_MS = 250;

export interface VoiceTurnOptions {
  /** Voice is chosen for this game and it is this player's turn. */
  enabled: boolean;
  /** The Whisper hint for this turn (`buildTranscribeHint`). */
  hint: () => string;
  /** The words that were heard, with the recording (the Tireur needs its envelope). */
  onTranscript: (text: string, recording: Recording) => Promise<void> | void;
}

export interface VoiceTurn {
  /** Voice can't be used on this device now (no microphone, refused, not configured). */
  off: boolean;
  phase: CapturePhase;
  level: number;
  talkMode: TalkMode;
  /** What was understood, as said ("Ancien"). */
  heard: string | null;
  /** A short line under the button: "Je n'ai pas bien compris…". */
  notice: string | null;
  setNotice: (notice: string | null) => void;
  /** The fallback banner: voice failed, play with the buttons. */
  fallback: string | null;
  dismissFallback: () => void;
  pressIn: () => void;
  pressOut: () => void;
  tap: () => void;
}

/** "Ancien ?" → « Ancien » for the "J'ai entendu" line. */
export function cleanTranscript(text: string): string {
  return text.trim().replace(/^[\s.,;:!?…«»"]+|[\s.,;:!?…«»"]+$/gu, '');
}

export function useVoiceTurn(options: VoiceTurnOptions): VoiceTurn {
  const settings = useVoiceSettings();
  const [heard, setHeard] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const [unsupportedSeen, setUnsupportedSeen] = useState(false);
  const latest = useRef(options);
  latest.current = options;

  const onRecorderError = useCallback((code: RecorderErrorCode) => {
    if (code === 'PERMISSION_DENIED') {
      setOff(true);
      setFallback(fr.voice.micDenied);
    } else if (code === 'UNAVAILABLE') {
      setOff(true);
      setFallback(fr.voice.micUnavailable);
    } else {
      setFallback(fr.voice.micFailed);
    }
  }, []);

  const onRecording = useCallback(async (recording: Recording) => {
    setHeard(null);
    setNotice(null);
    if (recording.durationMs < MIN_RECORDING_MS) {
      setNotice(fr.voice.tooShort);
      return;
    }
    let text: string;
    try {
      const result = await getTranscriber().transcribe(recording, {
        hint: latest.current.hint(),
        durationMs: recording.durationMs,
      });
      text = result.text;
    } catch (caught) {
      const failure = caught instanceof TranscribeError ? caught : null;
      if (failure?.code === 'DSA_VOICE_NOT_CONFIGURED') setOff(true);
      setFallback(failure ? failure.messageFr : fr.voice.serviceDown);
      return;
    }
    setFallback(null);
    const said = cleanTranscript(text);
    setHeard(said === '' ? null : said);
    await latest.current.onTranscript(text, recording);
  }, []);

  const capture = useVoiceCapture({
    enabled: options.enabled && !off,
    talkMode: settings.talkMode,
    onRecording,
    onRecorderError,
  });

  // A new turn starts clean.
  useEffect(() => {
    if (!options.enabled) setNotice(null);
  }, [options.enabled]);

  // A new recording replaces what was heard last time.
  useEffect(() => {
    if (capture.phase === 'starting') {
      setHeard(null);
      setNotice(null);
    }
  }, [capture.phase]);

  return {
    off: off || !capture.supported,
    phase: capture.phase,
    level: capture.level,
    talkMode: settings.talkMode,
    heard,
    notice,
    setNotice,
    fallback: fallback ?? (!capture.supported && options.enabled && !unsupportedSeen ? fr.voice.micUnavailable : null),
    dismissFallback: () => {
      setFallback(null);
      setUnsupportedSeen(true);
    },
    pressIn: capture.pressIn,
    pressOut: capture.pressOut,
    tap: capture.tap,
  };
}
