import { describe, expect, it } from 'vitest';
import { CALIBRATION_THRESHOLD_FLOOR_MS, DEFAULT_CALIBRATION, analyzeEnvelope, calibrate, median, parseCalibration } from '../src';
import type { EnvelopeAnalysis } from '../src';
import { VOICE_DB, spoken } from './helpers';

const sample = (ms: number): EnvelopeAnalysis => analyzeEnvelope(spoken([[ms, VOICE_DB]]));
const silent = (): EnvelopeAnalysis => analyzeEnvelope(spoken([]));

describe('calibrate', () => {
  it('puts the threshold halfway between the medians', () => {
    const c = calibrate([sample(300), sample(350), sample(250)], [sample(1100), sample(1000), sample(1200)]);
    expect(c).toEqual({ thresholdMs: 700, shortMedianMs: 300, longMedianMs: 1100, quality: 'good' });
  });

  it('never goes below the 550 ms floor', () => {
    const c = calibrate([sample(150), sample(200)], [sample(700), sample(750)]);
    expect(c.shortMedianMs).toBe(175);
    expect(c.longMedianMs).toBe(725);
    expect(c.thresholdMs).toBe(CALIBRATION_THRESHOLD_FLOOR_MS);
    expect(c.quality).toBe('good');
  });

  it('is weak when the medians are less than 250 ms apart', () => {
    const c = calibrate([sample(400)], [sample(600)]);
    expect(c.quality).toBe('weak');
    expect(c.thresholdMs).toBe(550);
  });

  it('exactly 250 ms apart is good', () => {
    expect(calibrate([sample(400)], [sample(650)]).quality).toBe('good');
  });

  it('ignores samples with no voice, and is weak when a whole set is missing', () => {
    const c = calibrate([silent(), sample(300)], [silent()]);
    expect(c.shortMedianMs).toBe(300);
    expect(c.longMedianMs).toBe(DEFAULT_CALIBRATION.longMedianMs);
    expect(c.quality).toBe('weak');
  });

  it('the default calibration is 300 / 1000 ms, threshold 650 ms', () => {
    expect(DEFAULT_CALIBRATION).toEqual({ thresholdMs: 650, shortMedianMs: 300, longMedianMs: 1000, quality: 'good' });
    expect(Object.isFrozen(DEFAULT_CALIBRATION)).toBe(true);
  });

  it('median of even and odd lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(Number.isNaN(median([]))).toBe(true);
  });

  it('parseCalibration reads back stored JSON and rejects junk', () => {
    const stored = JSON.parse(JSON.stringify(calibrate([sample(300)], [sample(1000)])));
    expect(parseCalibration(stored)).toEqual({ thresholdMs: 650, shortMedianMs: 300, longMedianMs: 1000, quality: 'good' });
    expect(parseCalibration(null)).toBeNull();
    expect(parseCalibration({ thresholdMs: 'x', shortMedianMs: 1, longMedianMs: 2, quality: 'good' })).toBeNull();
    expect(parseCalibration({ thresholdMs: 600, shortMedianMs: 300, longMedianMs: 900, quality: 'great' })).toBeNull();
  });
});
