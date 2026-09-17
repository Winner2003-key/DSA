/**
 * The talking gesture, shared by the game and the calibration screen:
 *
 * - HOLD ("Maintenir pour parler", default): recording runs while the button is
 *   held, plus a short tail after release — the envelope needs some quiet frames
 *   to find the room's noise floor.
 * - FREE ("Parler librement"): one tap starts; it stops by itself after 800 ms of
 *   silence following the voice, or after 8 s. A second tap stops at once.
 *
 * Text-to-speech is stopped and held back while the microphone is open.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { detectEndOfSpeech, type EnvelopeSample } from '@dsa/voice';

import { useRecorder } from './recorder';
import { RecorderError, type Recorder, type RecorderErrorCode, type Recording } from './recorder-types';
import { useSpeech } from './use-speech';
import type { TalkMode } from './voice-settings';

/** Kept recording after the button is released. */
export const HOLD_TAIL_MS = 400;

export type CapturePhase = 'idle' | 'starting' | 'listening' | 'processing';

export interface VoiceCaptureOptions {
  /** The microphone may be used now (your turn, voice not turned off). */
  enabled: boolean;
  talkMode: TalkMode;
  /** Receives each finished recording; the phase stays `processing` until it settles. */
  onRecording: (recording: Recording) => Promise<void> | void;
  /** The recorder refused (permission, no microphone, failure). */
  onRecorderError?: (code: RecorderErrorCode) => void;
  /** Injected in tests: 0 stops at once on release. */
  holdTailMs?: number;
}

export interface VoiceCapture {
  supported: boolean;
  phase: CapturePhase;
  /** Live input level, 0…1, while listening. */
  level: number;
  /** HOLD: the button went down / up. */
  pressIn: () => void;
  pressOut: () => void;
  /** FREE: a tap starts, a second tap stops. */
  tap: () => void;
  cancel: () => void;
}

/** −60 dBFS and below is silence on the meter, −10 dBFS is full. */
export function levelOf(db: number): number {
  return Math.max(0, Math.min(1, (db + 60) / 50));
}

export function useVoiceCapture(options: VoiceCaptureOptions): VoiceCapture {
  const recorder: Recorder = useRecorder();
  const speech = useSpeech();
  const [phase, setPhase] = useState<CapturePhase>('idle');
  const [level, setLevel] = useState(0);

  const phaseRef = useRef<CapturePhase>('idle');
  const mounted = useRef(true);
  const releasePending = useRef(false);
  const samples = useRef<EnvelopeSample[]>([]);
  const tailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const tailMs = options.holdTailMs ?? HOLD_TAIL_MS;

  const move = useCallback((next: CapturePhase) => {
    phaseRef.current = next;
    if (mounted.current) setPhase(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const finish = useCallback(async () => {
    if (phaseRef.current !== 'listening') return;
    if (tailTimer.current) clearTimeout(tailTimer.current);
    tailTimer.current = null;
    move('processing');
    if (mounted.current) setLevel(0);
    let recording: Recording | null = null;
    try {
      recording = await recorder.stop();
    } catch (caught) {
      speech.setListening(false);
      move('idle');
      latest.current.onRecorderError?.(caught instanceof RecorderError ? caught.code : 'FAILED');
      return;
    }
    speech.setListening(false);
    if (!recording) {
      move('idle');
      return;
    }
    try {
      await latest.current.onRecording(recording);
    } finally {
      move('idle');
    }
  }, [move, recorder, speech]);

  const begin = useCallback(async () => {
    if (!latest.current.enabled || phaseRef.current !== 'idle') return;
    move('starting');
    releasePending.current = false;
    samples.current = [];
    speech.setListening(true);
    const free = latest.current.talkMode === 'FREE';
    try {
      await recorder.start((sample) => {
        samples.current.push(sample);
        if (mounted.current) setLevel(levelOf(sample.db));
        if (free && phaseRef.current === 'listening' && detectEndOfSpeech(samples.current).stop) void finish();
      });
    } catch (caught) {
      speech.setListening(false);
      move('idle');
      latest.current.onRecorderError?.(caught instanceof RecorderError ? caught.code : 'FAILED');
      return;
    }
    if (!mounted.current || !latest.current.enabled) {
      speech.setListening(false);
      await recorder.cancel();
      move('idle');
      return;
    }
    move('listening');
    if (releasePending.current) {
      releasePending.current = false;
      tailTimer.current = setTimeout(() => void finish(), tailMs);
    }
  }, [finish, move, recorder, speech, tailMs]);

  const cancel = useCallback(() => {
    if (tailTimer.current) clearTimeout(tailTimer.current);
    tailTimer.current = null;
    releasePending.current = false;
    if (phaseRef.current === 'listening' || phaseRef.current === 'starting') {
      void recorder.cancel();
      speech.setListening(false);
      move('idle');
      if (mounted.current) setLevel(0);
    }
  }, [move, recorder, speech]);

  // The turn ended (or voice was turned off) while the microphone was open.
  useEffect(() => {
    if (!options.enabled) cancel();
  }, [cancel, options.enabled]);

  // Leaving the screen closes the microphone.
  useEffect(() => () => {
    if (tailTimer.current) clearTimeout(tailTimer.current);
    if (phaseRef.current === 'listening' || phaseRef.current === 'starting') {
      void recorder.cancel();
      speech.setListening(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pressIn = useCallback(() => {
    void begin();
  }, [begin]);

  const pressOut = useCallback(() => {
    if (phaseRef.current === 'starting') {
      releasePending.current = true;
      return;
    }
    if (phaseRef.current !== 'listening' || tailTimer.current) return;
    if (tailMs <= 0) void finish();
    else tailTimer.current = setTimeout(() => void finish(), tailMs);
  }, [finish, tailMs]);

  const tap = useCallback(() => {
    if (phaseRef.current === 'idle') void begin();
    else if (phaseRef.current === 'listening') void finish();
  }, [begin, finish]);

  return { supported: recorder.supported, phase, level, pressIn, pressOut, tap, cancel };
}
