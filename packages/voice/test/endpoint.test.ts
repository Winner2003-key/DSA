import { describe, expect, it } from 'vitest';

import { detectEndOfSpeech, FREE_TALK_MAX_MS, FREE_TALK_SILENCE_MS } from '../src/endpoint';
import type { EnvelopeSample } from '../src/envelope';
import { envelope, SILENCE_DB, VOICE_DB } from './helpers';

/** Feeds the samples one by one, like the recorder does, and returns when it would stop. */
function run(samples: EnvelopeSample[]) {
  for (let i = 1; i <= samples.length; i++) {
    const decision = detectEndOfSpeech(samples.slice(0, i));
    if (decision.stop) return { atMs: samples[i - 1]!.tMs, ...decision };
  }
  return null;
}

describe('detectEndOfSpeech', () => {
  it('exports the brief values: 800 ms of silence, 8 s at most', () => {
    expect(FREE_TALK_SILENCE_MS).toBe(800);
    expect(FREE_TALK_MAX_MS).toBe(8000);
  });

  it('never stops on an empty recording', () => {
    expect(detectEndOfSpeech([])).toEqual({ stop: false, voiced: false });
  });

  it('stops 800 ms after a short "oui"', () => {
    const stop = run(envelope([[600, SILENCE_DB], [300, VOICE_DB], [2000, SILENCE_DB]]));
    expect(stop?.reason).toBe('SILENCE_AFTER_VOICE');
    // Voice ends at 900 ms; the last loud frame starts at 850.
    expect(stop?.atMs).toBeGreaterThanOrEqual(850 + 800);
    expect(stop?.atMs).toBeLessThanOrEqual(900 + 850);
  });

  it('does not stop during a held "ouiiii" or a short pause between words', () => {
    const samples = envelope([[500, SILENCE_DB], [1500, VOICE_DB], [400, SILENCE_DB], [300, VOICE_DB], [1500, SILENCE_DB]]);
    const stop = run(samples);
    expect(stop?.reason).toBe('SILENCE_AFTER_VOICE');
    expect(stop?.atMs).toBeGreaterThan(2700 + 700);
  });

  it('keeps waiting while nobody has spoken yet, then stops at 8 s', () => {
    const quiet = envelope([[9000, SILENCE_DB]], { jitterDb: 2 });
    const stop = run(quiet);
    expect(stop).toMatchObject({ reason: 'MAX_LENGTH', voiced: false });
    expect(stop?.atMs).toBe(8000);
  });

  it('stops at 8 s when the voice never ends (a noisy room)', () => {
    const stop = run(envelope([[300, SILENCE_DB], [9000, VOICE_DB]], { jitterDb: 3 }));
    expect(stop).toMatchObject({ reason: 'MAX_LENGTH' });
  });

  it('respects custom limits', () => {
    const samples = envelope([[500, SILENCE_DB], [300, VOICE_DB], [500, SILENCE_DB]]);
    expect(detectEndOfSpeech(samples, { silenceMs: 300 })).toMatchObject({ stop: true, reason: 'SILENCE_AFTER_VOICE' });
    expect(detectEndOfSpeech(samples, { maxMs: 1000 })).toMatchObject({ stop: true, reason: 'MAX_LENGTH' });
  });
});
