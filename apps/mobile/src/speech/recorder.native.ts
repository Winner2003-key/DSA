/**
 * Recording on Android and iOS with expo-audio (included in Expo Go, SDK 57).
 *
 * - `useAudioRecorder` with the HIGH_QUALITY preset (an .m4a file: Android
 *   mpeg4/aac, iOS MPEG4AAC), in mono at 64 kbit/s, which is plenty for a word and
 *   keeps the upload small, and `isMeteringEnabled`.
 * - The level is read with `recorder.getStatus()` every 50 ms. `tMs` is the
 *   recording clock (`durationMillis`), so a busy JS thread can't stretch a sound.
 * - The audio session is switched to recording only while recording: on iOS a
 *   play-and-record session sends text-to-speech to the earpiece, where nobody at
 *   the table would hear it.
 */
import { useCallback, useMemo, useRef } from 'react';
import {
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import type { EnvelopeSample } from '@dsa/voice';

import { METERING_INTERVAL_MS, RecorderError, type Recorder, type Recording } from './recorder-types';

export * from './recorder-types';

const OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64000,
  isMeteringEnabled: true,
};

async function setRecordingMode(allowsRecording: boolean): Promise<void> {
  try {
    await setAudioModeAsync({ allowsRecording, playsInSilentMode: true });
  } catch {
    // An audio-mode failure must not stop the game; recording itself reports real problems.
  }
}

export function useRecorder(): Recorder {
  const recorder = useAudioRecorder(OPTIONS);
  const session = useRef<{ samples: EnvelopeSample[]; timer: ReturnType<typeof setInterval>; lastMs: number } | null>(null);

  const requestPermission = useCallback(async () => {
    try {
      const current = await getRecordingPermissionsAsync();
      if (current.granted) return true;
      if (current.canAskAgain === false) return false;
      return (await requestRecordingPermissionsAsync()).granted;
    } catch {
      return false;
    }
  }, []);

  const finish = useCallback(async (): Promise<Recording | null> => {
    const current = session.current;
    if (!current) return null;
    session.current = null;
    clearInterval(current.timer);
    try {
      await recorder.stop();
    } catch (caught) {
      await setRecordingMode(false);
      throw new RecorderError('FAILED', String(caught));
    }
    await setRecordingMode(false);
    const uri = recorder.uri;
    if (!uri) throw new RecorderError('FAILED', 'no file');
    const durationMs = Math.max(current.lastMs, Math.round((recorder.currentTime ?? 0) * 1000));
    return {
      audio: { kind: 'file', uri },
      mimeType: 'audio/m4a',
      fileName: 'parole.m4a',
      durationMs,
      envelope: current.samples,
    };
  }, [recorder]);

  const start = useCallback(
    async (onSample?: (sample: EnvelopeSample) => void) => {
      if (session.current) return;
      if (!(await requestPermission())) throw new RecorderError('PERMISSION_DENIED');
      try {
        await setRecordingMode(true);
        await recorder.prepareToRecordAsync();
        recorder.record();
      } catch (caught) {
        await setRecordingMode(false);
        throw new RecorderError('FAILED', String(caught));
      }
      const samples: EnvelopeSample[] = [];
      const timer = setInterval(() => {
        const status = recorder.getStatus();
        if (!status.isRecording || typeof status.metering !== 'number') return;
        const sample = { tMs: status.durationMillis, db: status.metering };
        samples.push(sample);
        if (session.current) session.current.lastMs = status.durationMillis;
        onSample?.(sample);
      }, METERING_INTERVAL_MS);
      session.current = { samples, timer, lastMs: 0 };
    },
    [recorder, requestPermission],
  );

  const cancel = useCallback(async () => {
    try {
      await finish();
    } catch {
      // Nothing to keep.
    }
  }, [finish]);

  return useMemo<Recorder>(
    () => ({ supported: true, requestPermission, start, stop: finish, cancel }),
    [cancel, finish, requestPermission, start],
  );
}
