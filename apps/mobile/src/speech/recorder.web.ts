/**
 * Recording in the browser: `getUserMedia` + `MediaRecorder` for the audio
 * (Chrome/Firefox give webm/opus, Safari gives mp4/aac — both accepted by
 * `transcribe`), and a Web Audio `AnalyserNode` on the same stream for the
 * loudness envelope: RMS every 50 ms, converted with `rmsToDb`.
 *
 * The microphone is opened for each recording and released right after, so the
 * browser's "mic in use" indicator is only on while the player is talking.
 * Needs a secure context (https, or localhost).
 */
import { useCallback, useMemo, useRef } from 'react';
import { rmsToDb, type EnvelopeSample } from '@dsa/voice';

import { METERING_INTERVAL_MS, RecorderError, type Recorder, type Recording } from './recorder-types';

export * from './recorder-types';

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

function fileNameFor(mimeType: string): string {
  if (mimeType.includes('mp4') || mimeType.includes('aac')) return 'parole.m4a';
  if (mimeType.includes('ogg')) return 'parole.ogg';
  return 'parole.webm';
}

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  const g = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

function isSupported(): boolean {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  return Boolean(nav?.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined' && audioContextCtor() !== null;
}

interface Session {
  stream: MediaStream;
  media: MediaRecorder;
  context: AudioContext;
  chunks: Blob[];
  samples: EnvelopeSample[];
  timer: ReturnType<typeof setInterval>;
  startedAt: number;
  mimeType: string;
}

function release(session: Session): void {
  clearInterval(session.timer);
  session.stream.getTracks().forEach((track) => track.stop());
  void session.context.close().catch(() => undefined);
}

function permissionError(caught: unknown): RecorderError {
  const name = (caught as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return new RecorderError('PERMISSION_DENIED', name);
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') {
    return new RecorderError('UNAVAILABLE', name);
  }
  return new RecorderError('FAILED', String(caught));
}

export function useRecorder(): Recorder {
  const session = useRef<Session | null>(null);
  const starting = useRef(false);
  const supported = isSupported();

  const requestPermission = useCallback(async () => {
    if (!isSupported()) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch {
      return false;
    }
  }, []);

  const start = useCallback(async (onSample?: (sample: EnvelopeSample) => void) => {
    if (session.current || starting.current) return;
    const Ctor = audioContextCtor();
    if (!isSupported() || !Ctor) throw new RecorderError('UNAVAILABLE');
    starting.current = true;
    // Created inside the press handler, before any await, so autoplay rules let it run.
    const context = new Ctor();
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        });
      } catch (caught) {
        void context.close().catch(() => undefined);
        throw permissionError(caught);
      }
      if (context.state === 'suspended') await context.resume().catch(() => undefined);

      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);

      const preferred = pickMimeType();
      let media: MediaRecorder;
      try {
        media = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
      } catch (caught) {
        stream.getTracks().forEach((track) => track.stop());
        void context.close().catch(() => undefined);
        throw new RecorderError('FAILED', String(caught));
      }
      const chunks: Blob[] = [];
      media.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };

      const samples: EnvelopeSample[] = [];
      const startedAt = performance.now();
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += (buffer[i] as number) * (buffer[i] as number);
        const sample = { tMs: Math.round(performance.now() - startedAt), db: rmsToDb(Math.sqrt(sum / buffer.length)) };
        samples.push(sample);
        onSample?.(sample);
      }, METERING_INTERVAL_MS);

      media.start(250);
      session.current = {
        stream,
        media,
        context,
        chunks,
        samples,
        timer,
        startedAt,
        mimeType: media.mimeType || preferred || 'audio/webm',
      };
    } finally {
      starting.current = false;
    }
  }, []);

  const stop = useCallback(async (): Promise<Recording | null> => {
    const current = session.current;
    if (!current) return null;
    session.current = null;
    clearInterval(current.timer);
    const durationMs = Math.round(performance.now() - current.startedAt);
    try {
      if (current.media.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          current.media.addEventListener('stop', () => resolve(), { once: true });
          current.media.stop();
        });
      }
    } finally {
      release(current);
    }
    const blob = new Blob(current.chunks, { type: current.mimeType });
    if (blob.size === 0) throw new RecorderError('FAILED', 'empty recording');
    return {
      audio: { kind: 'blob', blob },
      mimeType: current.mimeType,
      fileName: fileNameFor(current.mimeType),
      durationMs,
      envelope: current.samples,
    };
  }, []);

  const cancel = useCallback(async () => {
    const current = session.current;
    if (!current) return;
    session.current = null;
    try {
      if (current.media.state !== 'inactive') current.media.stop();
    } catch {
      // Already stopped.
    }
    release(current);
  }, []);

  return useMemo<Recorder>(() => ({ supported, requestPermission, start, stop, cancel }), [cancel, requestPermission, start, stop, supported]);
}
