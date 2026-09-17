import type { EnvelopeSample } from '@dsa/voice';

/**
 * One short recording (an answer, a question, a calibration take), in the form the
 * `transcribe` function accepts, with the loudness envelope measured while it ran.
 *
 * Native (expo-audio) writes an .m4a file; the web (MediaRecorder) produces a Blob.
 */
export type RecordedAudio = { kind: 'file'; uri: string } | { kind: 'blob'; blob: Blob };

export interface Recording {
  audio: RecordedAudio;
  /** `audio/m4a`, `audio/webm`, `audio/mp4`, `audio/ogg`… (parameters after ";" are ignored by the server). */
  mimeType: string;
  fileName: string;
  /** Length measured by the recording clock. */
  durationMs: number;
  /** `{tMs, db}` every ~50 ms, `tMs` from the recording clock (not Date.now()). */
  envelope: EnvelopeSample[];
}

export type RecorderErrorCode = 'PERMISSION_DENIED' | 'UNAVAILABLE' | 'FAILED';

export class RecorderError extends Error {
  readonly code: RecorderErrorCode;

  constructor(code: RecorderErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'RecorderError';
    this.code = code;
  }
}

/** Metering is collected this often (expo-audio's own polling defaults to 500 ms: far too coarse). */
export const METERING_INTERVAL_MS = 50;

/**
 * The one recording interface of the app. `recorder.native.ts` (expo-audio, works
 * in Expo Go) and `recorder.web.ts` (getUserMedia + MediaRecorder + AnalyserNode)
 * implement it as a hook; Metro picks the file for the platform.
 */
export interface Recorder {
  /** False when this platform or browser cannot record at all. */
  readonly supported: boolean;
  /** Asks for the microphone if needed; resolves false when refused. */
  requestPermission(): Promise<boolean>;
  /**
   * Starts recording. `onSample` receives each metering sample as it is measured
   * (live level meter, end-of-speech detection). Rejects with a RecorderError.
   */
  start(onSample?: (sample: { tMs: number; db: number }) => void): Promise<void>;
  /** Stops and returns the recording, or null when nothing was being recorded. */
  stop(): Promise<Recording | null>;
  /** Stops and throws the recording away. */
  cancel(): Promise<void>;
}
