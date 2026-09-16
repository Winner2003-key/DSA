// Per-person calibration: "Dis OUI", then "Dis OUI très long" (GRAPH_SPECIFICATION §1).

import type { EnvelopeAnalysis } from './envelope';

/** The threshold is never below this, even for a very fast speaker. */
export const CALIBRATION_THRESHOLD_FLOOR_MS = 550;
/** Medians closer than this don't separate the two sounds well: quality 'weak'. */
export const CALIBRATION_MIN_SEPARATION_MS = 250;
/** Typical plain "oui" (0.2–0.4 s) and held "ouiiii" (0.7 s and more). */
export const DEFAULT_SHORT_MS = 300;
export const DEFAULT_LONG_MS = 1000;

export type CalibrationQuality = 'good' | 'weak';

export interface Calibration {
  /** A sound at least this long is the repeated code (OUIOUIOUI / NONONONON). */
  thresholdMs: number;
  shortMedianMs: number;
  longMedianMs: number;
  quality: CalibrationQuality;
}

export const DEFAULT_CALIBRATION: Readonly<Calibration> = Object.freeze({
  thresholdMs: (DEFAULT_SHORT_MS + DEFAULT_LONG_MS) / 2,
  shortMedianMs: DEFAULT_SHORT_MS,
  longMedianMs: DEFAULT_LONG_MS,
  quality: 'good',
});

/**
 * The length that separates OUI from "ouiiii": the longest continuous voiced
 * burst. Calibration and the answer decision both use it, so they measure the
 * same thing ("euh… oui" doesn't count as one long sound).
 */
export function soundLengthMs(analysis: EnvelopeAnalysis): number {
  return analysis.longestBurstMs;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Builds a calibration from the short samples ("OUI") and the long samples
 * ("OUI très long"). Samples with no detected voice are ignored; if a whole
 * set is unusable its default is used and the quality is 'weak'.
 */
export function calibrate(shortSamples: readonly EnvelopeAnalysis[], longSamples: readonly EnvelopeAnalysis[]): Calibration {
  const lengths = (set: readonly EnvelopeAnalysis[]) => set.map(soundLengthMs).filter((ms) => ms > 0);
  const shortLengths = lengths(shortSamples);
  const longLengths = lengths(longSamples);
  const shortMedianMs = shortLengths.length > 0 ? median(shortLengths) : DEFAULT_SHORT_MS;
  const longMedianMs = longLengths.length > 0 ? median(longLengths) : DEFAULT_LONG_MS;
  const thresholdMs = Math.max(CALIBRATION_THRESHOLD_FLOOR_MS, Math.round((shortMedianMs + longMedianMs) / 2));
  const separated = longMedianMs - shortMedianMs >= CALIBRATION_MIN_SEPARATION_MS;
  const complete = shortLengths.length > 0 && longLengths.length > 0;
  return { thresholdMs, shortMedianMs, longMedianMs, quality: separated && complete ? 'good' : 'weak' };
}

/** Reads a calibration back from local storage (JSON). Returns null when it isn't a valid one. */
export function parseCalibration(value: unknown): Calibration | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const ms = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x > 0 && x < 60_000;
  if (!ms(v.thresholdMs) || !ms(v.shortMedianMs) || !ms(v.longMedianMs)) return null;
  if (v.quality !== 'good' && v.quality !== 'weak') return null;
  return {
    thresholdMs: v.thresholdMs as number,
    shortMedianMs: v.shortMedianMs as number,
    longMedianMs: v.longMedianMs as number,
    quality: v.quality,
  };
}
