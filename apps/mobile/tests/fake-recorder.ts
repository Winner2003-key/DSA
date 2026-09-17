/**
 * A scripted microphone for the voice tests. Install it with
 *   jest.mock('@/speech/recorder', () => require('./fake-recorder'));
 * then set `fakeMic.next` to the recording the next take should return.
 */
import { useMemo } from 'react';
import type { EnvelopeSample } from '@dsa/voice';

import { RecorderError, type Recorder, type RecorderErrorCode, type Recording } from '@/speech/recorder-types';

export * from '@/speech/recorder-types';

export const SILENCE_DB = -55;
export const VOICE_DB = -20;

export const fakeMic: {
  next: Recording | null;
  /** Makes `start` reject, as a refused permission would. */
  error: RecorderErrorCode | null;
  starts: number;
  stops: number;
  cancels: number;
} = { next: null, error: null, starts: 0, stops: 0, cancels: 0 };

export function resetFakeMic(): void {
  fakeMic.next = null;
  fakeMic.error = null;
  fakeMic.starts = 0;
  fakeMic.stops = 0;
  fakeMic.cancels = 0;
}

/** 50 ms metering frames: [durationMs, dB] pieces, like expo-audio. */
export function envelopeOf(pieces: [number, number][]): EnvelopeSample[] {
  const samples: EnvelopeSample[] = [];
  let t = 0;
  for (const [duration, db] of pieces) {
    for (let elapsed = 0; elapsed < duration; elapsed += 50) {
      samples.push({ tMs: t, db });
      t += 50;
    }
  }
  return samples;
}

/** Quiet, one sound of `voiceMs`, quiet: a plain "oui" is ~300 ms, a held "ouiiii" ~1100 ms. */
export function recordingOf(voiceMs: number, pieces?: [number, number][]): Recording {
  const envelope = envelopeOf(pieces ?? [[500, SILENCE_DB], [voiceMs, VOICE_DB], [500, SILENCE_DB]]);
  const last = envelope[envelope.length - 1];
  return {
    audio: { kind: 'file', uri: 'file:///cache/parole.m4a' },
    mimeType: 'audio/m4a',
    fileName: 'parole.m4a',
    durationMs: last ? last.tMs + 50 : 0,
    envelope,
  };
}

export function useRecorder(): Recorder {
  return useMemo<Recorder>(
    () => ({
      supported: true,
      requestPermission: async () => fakeMic.error !== 'PERMISSION_DENIED',
      start: async () => {
        if (fakeMic.error) throw new RecorderError(fakeMic.error);
        fakeMic.starts += 1;
      },
      stop: async () => {
        fakeMic.stops += 1;
        return fakeMic.next;
      },
      cancel: async () => {
        fakeMic.cancels += 1;
      },
    }),
    [],
  );
}
