/**
 * Speech-to-text — the interface only. S7 implements it.
 *
 * Planned shape (GRAPH_SPECIFICATION §1): record at most 30 s, post the audio to
 * the Supabase Edge Function `transcribe` (Groq whisper-large-v3-turbo, Hugging
 * Face fallback) with the current prompt as `hint`, and classify the Tireur's
 * answer from the *loudness envelope*, not from the text, because Whisper
 * normalises a held "ouiiii" to "Oui".
 *
 * Nothing in the UI may depend on this being available: the answer buttons are
 * always the primary, complete input path, and they are what Expo Go has today.
 */
export interface Transcription {
  text: string;
  provider: string;
  durationMs: number;
}

/** What S7's AnswerAudioClassifier will return alongside the transcription. */
export interface AnswerAudioVerdict {
  /** null when the sound is within ±15 % of the calibrated threshold: ask the player. */
  repeated: boolean | null;
  voicedMs: number;
  bursts: number;
}

export interface SpeechToText {
  /** False everywhere until S7 lands; the UI then hides the microphone affordance. */
  readonly available: boolean;
  /** Starts recording. Rejects when recording is unavailable or not permitted. */
  start(): Promise<void>;
  /** Stops recording and resolves with the transcription (and, later, the verdict). */
  stop(hint?: string): Promise<Transcription>;
  cancel(): void;
}

class UnavailableSpeechToText implements SpeechToText {
  readonly available = false;

  async start(): Promise<void> {
    throw new Error('speech-to-text arrives in S7');
  }

  async stop(): Promise<Transcription> {
    throw new Error('speech-to-text arrives in S7');
  }

  cancel(): void {}
}

export const speechToText: SpeechToText = new UnavailableSpeechToText();
