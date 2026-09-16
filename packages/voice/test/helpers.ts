import type { EnvelopeSample } from '../src/envelope';

export const SILENCE_DB = -55;
export const VOICE_DB = -20;

/** Deterministic pseudo-random numbers in [0, 1). */
export function rng(seed = 42): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * Builds a metering envelope from [durationMs, dB] pieces, one sample every
 * frameMs, like expo-audio. `jitterDb` adds ± noise to every sample.
 */
export function envelope(pieces: [number, number][], opts: { frameMs?: number; jitterDb?: number; seed?: number } = {}): EnvelopeSample[] {
  const frameMs = opts.frameMs ?? 50;
  const random = rng(opts.seed);
  const samples: EnvelopeSample[] = [];
  let t = 0;
  for (const [duration, db] of pieces) {
    for (let elapsed = 0; elapsed < duration; elapsed += frameMs) {
      const jitter = opts.jitterDb ? (random() * 2 - 1) * opts.jitterDb : 0;
      samples.push({ tMs: t, db: db + jitter });
      t += frameMs;
    }
  }
  return samples;
}

/** Silence, then the spoken pieces, then silence. */
export function spoken(pieces: [number, number][], opts: { lead?: number; tail?: number; jitterDb?: number } = {}): EnvelopeSample[] {
  return envelope([[opts.lead ?? 500, SILENCE_DB], ...pieces, [opts.tail ?? 500, SILENCE_DB]], { jitterDb: opts.jitterDb });
}
