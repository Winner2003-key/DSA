/**
 * The talking gesture, shared by the game and the calibration screen, as in a
 * messaging app's voice note:
 *
 * - hold the microphone: it records while held, plus a short tail after release
 *   (the envelope needs some quiet frames to find the room's noise floor);
 * - slide up while holding: the recording is locked, and goes on after the
 *   finger leaves ("parler librement") until the microphone is touched again,
 *   or MAX_LOCKED_MS at most.
 *
 * Text-to-speech is stopped and held back while the microphone is open.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EnvelopeSample } from '@dsa/voice';

import { useRecorder } from './recorder';
import { RecorderError, type Recorder, type RecorderErrorCode, type Recording } from './recorder-types';
import { useSpeech } from './use-speech';

/** Kept recording after the button is released. */
export const HOLD_TAIL_MS = 400;
/** A locked recording nobody stops is closed after this long (the server takes 30 s at most). */
export const MAX_LOCKED_MS = 25_000;

export type CapturePhase = 'idle' | 'starting' | 'listening' | 'processing';

export interface VoiceCaptureOptions {
  /** The microphone may be used now (your turn, voice not turned off). */
  enabled: boolean;
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
  /** The recording goes on after release: the finger slid up while holding. */
  locked: boolean;
  /** The microphone went down / up. */
  pressIn: () => void;
  pressOut: () => void;
  /** Slide up while holding: keep recording after release. */
  lock: () => void;
  /**
   * Stops a locked recording. When idle it starts one already locked: the way in
   * for a screen reader, which cannot hold and slide.
   */
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
  const [locked, setLocked] = useState(false);

  const phaseRef = useRef<CapturePhase>('idle');
  const mounted = useRef(true);
  const releasePending = useRef(false);
  const lockedRef = useRef(false);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const samples = useRef<EnvelopeSample[]>([]);
  const tailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const tailMs = options.holdTailMs ?? HOLD_TAIL_MS;

  const move = useCallback((next: CapturePhase) => {
    phaseRef.current = next;
    if (mounted.current) setPhase(next);
    if (next === 'idle' || next === 'processing') {
      lockedRef.current = false;
      if (mounted.current) setLocked(false);
      if (maxTimer.current) clearTimeout(maxTimer.current);
      maxTimer.current = null;
    }
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
    try {
      await recorder.start((sample) => {
        samples.current.push(sample);
        if (mounted.current) setLevel(levelOf(sample.db));
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
    maxTimer.current = setTimeout(() => void finish(), MAX_LOCKED_MS);
    if (releasePending.current && !lockedRef.current) {
      releasePending.current = false;
      tailTimer.current = setTimeout(() => void finish(), tailMs);
    }
  }, [finish, move, recorder, speech, tailMs]);

  const cancel = useCallback(() => {
    if (maxTimer.current) clearTimeout(maxTimer.current);
    maxTimer.current = null;
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
    if (maxTimer.current) clearTimeout(maxTimer.current);
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
    if (lockedRef.current) return;
    if (phaseRef.current === 'starting') {
      releasePending.current = true;
      return;
    }
    if (phaseRef.current !== 'listening' || tailTimer.current) return;
    if (tailMs <= 0) void finish();
    else tailTimer.current = setTimeout(() => void finish(), tailMs);
  }, [finish, tailMs]);

  const lock = useCallback(() => {
    if (lockedRef.current || (phaseRef.current !== 'starting' && phaseRef.current !== 'listening')) return;
    lockedRef.current = true;
    setLocked(true);
  }, []);

  const tap = useCallback(() => {
    if (phaseRef.current === 'idle') {
      if (!latest.current.enabled) return;
      lockedRef.current = true;
      setLocked(true);
      void begin();
    } else if (phaseRef.current === 'listening' && lockedRef.current) {
      void finish();
    }
  }, [begin, finish]);

  return { supported: recorder.supported, phase, level, locked, pressIn, pressOut, lock, tap, cancel };
}
