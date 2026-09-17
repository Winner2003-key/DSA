// End of speech for "Parler librement" (tap once, the app stops by itself).
//
// Works on the same metering envelope as analyzeEnvelope, while recording:
// stop after FREE_TALK_SILENCE_MS of quiet that follows some voice, or at
// FREE_TALK_MAX_MS whatever happens. Before any voice, silence never stops the
// recording (the player may take a moment to start).

import { analyzeEnvelope, HYSTERESIS_DB } from './envelope';
import type { EnvelopeOptions, EnvelopeSample } from './envelope';

/** Quiet after the voice that ends the recording. */
export const FREE_TALK_SILENCE_MS = 800;
/** A free-talk recording never lasts longer than this. */
export const FREE_TALK_MAX_MS = 8000;

export interface EndOfSpeechOptions {
  silenceMs?: number;
  maxMs?: number;
  envelope?: EnvelopeOptions;
}

export type EndOfSpeech =
  | { stop: false; voiced: boolean }
  | { stop: true; reason: 'SILENCE_AFTER_VOICE' | 'MAX_LENGTH'; voiced: boolean };

/**
 * Decides, from the samples so far, whether a free-talk recording should stop.
 * Call it after every new sample; it is cheap for a few seconds of 50 ms frames.
 */
export function detectEndOfSpeech(samples: readonly EnvelopeSample[], opts: EndOfSpeechOptions = {}): EndOfSpeech {
  const silenceMs = opts.silenceMs ?? FREE_TALK_SILENCE_MS;
  const maxMs = opts.maxMs ?? FREE_TALK_MAX_MS;
  if (samples.length === 0) return { stop: false, voiced: false };

  const lastT = Math.max(...samples.map((s) => s.tMs));
  const analysis = analyzeEnvelope(samples, opts.envelope);
  const voiced = analysis.bursts > 0;
  if (lastT >= maxMs) return { stop: true, reason: 'MAX_LENGTH', voiced };
  if (!voiced) return { stop: false, voiced };

  // The last frame still loud enough to count as voice (the hysteresis "off" level).
  const offDb = analysis.thresholdDb - (opts.envelope?.hysteresisDb ?? HYSTERESIS_DB);
  let lastLoudT = -Infinity;
  for (const s of samples) if (s.db >= offDb && s.tMs > lastLoudT) lastLoudT = s.tMs;
  if (lastT - lastLoudT >= silenceMs) return { stop: true, reason: 'SILENCE_AFTER_VOICE', voiced };
  return { stop: false, voiced };
}
