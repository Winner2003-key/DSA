import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FRAME_MS,
  HYSTERESIS_DB,
  MAX_BURST_GAP_MS,
  MAX_FRAME_MS,
  MERGE_GAP_MS,
  METER_MAX_DB,
  METER_MIN_DB,
  MIN_BURST_MS,
  MIN_NOISE_FLOOR_DB,
  NOISE_FLOOR_PERCENTILE,
  VOICE_MARGIN_DB,
  analyzeEnvelope,
  percentile,
  rmsToDb,
} from '../src';
import { SILENCE_DB, VOICE_DB, envelope, spoken } from './helpers';

describe('analyzeEnvelope — the spec cases', () => {
  it('a short "oui" of 300 ms is 1 burst', () => {
    const a = analyzeEnvelope(spoken([[300, VOICE_DB]]));
    expect(a.bursts).toBe(1);
    expect(a.voicedMs).toBe(300);
    expect(a.longestBurstMs).toBe(300);
    expect(a.segments[0]).toMatchObject({ startMs: 500, endMs: 800, durationMs: 300 });
  });

  it('a long "ouiiii" of 900 ms is 1 long burst', () => {
    const a = analyzeEnvelope(spoken([[900, VOICE_DB]]));
    expect(a.bursts).toBe(1);
    expect(a.longestBurstMs).toBe(900);
    expect(a.voicedMs).toBe(900);
  });

  it('"oui oui oui" is 3 bursts', () => {
    const a = analyzeEnvelope(spoken([[250, VOICE_DB], [200, SILENCE_DB], [250, VOICE_DB], [200, SILENCE_DB], [250, VOICE_DB]]));
    expect(a.bursts).toBe(3);
    expect(a.voicedMs).toBe(750);
    expect(a.longestBurstMs).toBe(250);
  });

  it('background noise alone is no voice', () => {
    const a = analyzeEnvelope(envelope([[2000, -45]], { jitterDb: 4 }));
    expect(a.bursts).toBe(0);
    expect(a.voicedMs).toBe(0);
    expect(a.segments).toEqual([]);
  });

  it('a "oui" over background noise is still 1 burst of about 300 ms', () => {
    const a = analyzeEnvelope(envelope([[600, -42], [300, -15], [600, -42]], { jitterDb: 3 }));
    expect(a.bursts).toBe(1);
    expect(a.voicedMs).toBe(300);
    expect(a.noiseFloorDb).toBeGreaterThan(-46);
    expect(a.noiseFloorDb).toBeLessThan(-38);
  });

  it('a clipped start (voice already there at the first sample) is measured from the first sample', () => {
    const a = analyzeEnvelope(envelope([[400, VOICE_DB], [800, SILENCE_DB]]));
    expect(a.bursts).toBe(1);
    expect(a.voicedMs).toBe(400);
    expect(a.clippedStart).toBe(true);
    expect(a.clippedEnd).toBe(false);
  });

  it('a clipped end (still speaking at the last sample) is flagged', () => {
    const a = analyzeEnvelope(envelope([[800, SILENCE_DB], [600, VOICE_DB]]));
    expect(a.voicedMs).toBe(600);
    expect(a.clippedEnd).toBe(true);
    expect(a.clippedStart).toBe(false);
  });
});

describe('analyzeEnvelope — merging, dropping, grouping', () => {
  it('merges a dip shorter than 80 ms into one sound', () => {
    const a = analyzeEnvelope(spoken([[400, VOICE_DB], [50, SILENCE_DB], [400, VOICE_DB]]));
    expect(a.bursts).toBe(1);
    expect(a.longestBurstMs).toBe(850);
  });

  it('keeps a 100 ms pause as two bursts', () => {
    const a = analyzeEnvelope(spoken([[300, VOICE_DB], [100, SILENCE_DB], [300, VOICE_DB]]));
    expect(a.bursts).toBe(2);
    expect(a.voicedMs).toBe(600);
    expect(a.longestBurstMs).toBe(300);
  });

  it('drops a click shorter than 60 ms', () => {
    const a = analyzeEnvelope(spoken([[50, VOICE_DB]]));
    expect(a.bursts).toBe(0);
  });

  it('a click near the word is merged or dropped, never a second burst', () => {
    const a = analyzeEnvelope(spoken([[50, -10], [400, SILENCE_DB], [300, VOICE_DB]]));
    expect(a.bursts).toBe(1);
    expect(a.voicedMs).toBe(300);
  });

  it('a sound after a pause longer than 700 ms is another utterance; the main one is kept', () => {
    const a = analyzeEnvelope(spoken([[150, VOICE_DB], [900, SILENCE_DB], [800, VOICE_DB]]));
    expect(a.bursts).toBe(1);
    expect(a.voicedMs).toBe(800);
    expect(a.segments[0]!.startMs).toBe(500 + 150 + 900);
  });

  it('a pause of exactly 700 ms still joins the same utterance', () => {
    const a = analyzeEnvelope(spoken([[300, VOICE_DB], [700, SILENCE_DB], [300, VOICE_DB]]));
    expect(a.bursts).toBe(2);
  });

  it('hysteresis: a sag between the off and on levels stays voiced', () => {
    // floor −55 → on −43, off −48; −45 is between them.
    const a = analyzeEnvelope(spoken([[200, VOICE_DB], [150, -45], [200, VOICE_DB]], { lead: 1000, tail: 1000 }));
    expect(a.thresholdDb).toBe(SILENCE_DB + VOICE_MARGIN_DB);
    expect(a.bursts).toBe(1);
    expect(a.longestBurstMs).toBe(550);
  });

  it('a level between off and on does not START a burst', () => {
    const a = analyzeEnvelope(spoken([[400, -45]], { lead: 1000, tail: 1000 }));
    expect(a.bursts).toBe(0);
  });
});

describe('analyzeEnvelope — robustness', () => {
  it('returns zeros for an empty envelope', () => {
    const a = analyzeEnvelope([]);
    expect(a).toMatchObject({ voicedMs: 0, bursts: 0, longestBurstMs: 0, noiseFloorDb: METER_MIN_DB, peakDb: METER_MIN_DB, totalMs: 0 });
  });

  it('clamps the noise floor for digital silence (−160) so hiss is not voice', () => {
    const a = analyzeEnvelope(envelope([[1000, -160], [200, -80], [1000, -160]]));
    expect(a.noiseFloorDb).toBe(MIN_NOISE_FLOOR_DB);
    expect(a.bursts).toBe(0);
    const b = analyzeEnvelope(envelope([[1000, -160], [300, -25], [1000, -160]]));
    expect(b.voicedMs).toBe(300);
  });

  it('sorts unsorted samples and ignores NaN; −Infinity is silence', () => {
    const samples = spoken([[300, VOICE_DB]]).reverse();
    samples.push({ tMs: 50, db: Number.NaN });
    samples[3] = { ...samples[3]!, db: -Infinity };
    const a = analyzeEnvelope(samples);
    expect(a.bursts).toBe(1);
    expect(a.voicedMs).toBe(300);
  });

  it('clamps values above 0 dBFS', () => {
    const a = analyzeEnvelope(spoken([[300, 12]]));
    expect(a.peakDb).toBe(METER_MAX_DB);
  });

  it('works with a 100 ms metering interval (Web Audio or a slow device)', () => {
    const a = analyzeEnvelope(envelope([[500, SILENCE_DB], [900, VOICE_DB], [500, SILENCE_DB]], { frameMs: 100 }));
    expect(a.longestBurstMs).toBe(900);
  });

  it('a metering hiccup inside the voice cannot inflate the length', () => {
    const samples = [
      ...[0, 50, 100, 150, 200].map((tMs) => ({ tMs, db: SILENCE_DB })),
      { tMs: 250, db: VOICE_DB },
      { tMs: 2250, db: VOICE_DB }, // 2 s without samples
      ...[2300, 2350, 2400, 2450, 2500].map((tMs) => ({ tMs, db: SILENCE_DB })),
    ];
    const a = analyzeEnvelope(samples);
    expect(a.bursts).toBe(1);
    expect(a.voicedMs).toBeLessThanOrEqual(MAX_FRAME_MS + 50);
  });

  it('a recording that is all voice with no quieter part detects nothing (the app then asks)', () => {
    const a = analyzeEnvelope(envelope([[600, VOICE_DB]]));
    expect(a.voicedMs).toBe(0);
  });

  it('options override the constants', () => {
    const samples = spoken([[300, VOICE_DB], [100, SILENCE_DB], [300, VOICE_DB]]);
    expect(analyzeEnvelope(samples).bursts).toBe(2);
    expect(analyzeEnvelope(samples, { mergeGapMs: 150 }).bursts).toBe(1);
  });
});

describe('envelope helpers and constants', () => {
  it('exports the documented constants', () => {
    expect({ NOISE_FLOOR_PERCENTILE, MIN_NOISE_FLOOR_DB, VOICE_MARGIN_DB, HYSTERESIS_DB, MIN_BURST_MS, MERGE_GAP_MS, MAX_BURST_GAP_MS, DEFAULT_FRAME_MS, MAX_FRAME_MS }).toEqual({
      NOISE_FLOOR_PERCENTILE: 10,
      MIN_NOISE_FLOOR_DB: -70,
      VOICE_MARGIN_DB: 12,
      HYSTERESIS_DB: 5,
      MIN_BURST_MS: 60,
      MERGE_GAP_MS: 80,
      MAX_BURST_GAP_MS: 700,
      DEFAULT_FRAME_MS: 50,
      MAX_FRAME_MS: 250,
    });
  });

  it('rmsToDb converts Web Audio RMS to dBFS', () => {
    expect(rmsToDb(1)).toBe(0);
    expect(rmsToDb(0.1)).toBeCloseTo(-20, 5);
    expect(rmsToDb(0)).toBe(METER_MIN_DB);
    expect(rmsToDb(Number.NaN)).toBe(METER_MIN_DB);
  });

  it('percentile uses the nearest rank', () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3);
    expect(percentile([5, 1, 4, 2, 3], 10)).toBe(1);
    expect(percentile([5, 1, 4, 2, 3], 100)).toBe(5);
  });
});
