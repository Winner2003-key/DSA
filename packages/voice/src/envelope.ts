// Loudness-envelope analysis: how long the Tireur's voice lasted, and in how
// many bursts. GRAPH_SPECIFICATION §1 "Recognising the Tireur's answers".
//
// Input is a metering envelope, not audio: expo-audio metering on native
// (about every 50 ms, dBFS, −160…0) or a Web Audio RMS converted with rmsToDb.

/** Lowest and highest metering values (dBFS). Values outside are clamped. */
export const METER_MIN_DB = -160;
export const METER_MAX_DB = 0;

/** The noise floor is this percentile of the recording's levels (quiet parts). */
export const NOISE_FLOOR_PERCENTILE = 10;
/** The floor is never taken below this: digital silence (−160) would turn any hiss into "voice". */
export const MIN_NOISE_FLOOR_DB = -70;
/** A frame becomes voiced at floor + this margin… */
export const VOICE_MARGIN_DB = 12;
/** …and stays voiced until it drops below (floor + margin − hysteresis). */
export const HYSTERESIS_DB = 5;

/** Voiced runs shorter than this are clicks, not speech (dropped after merging). */
export const MIN_BURST_MS = 60;
/** Silences shorter than this inside a sound are dips, not pauses (merged). */
export const MERGE_GAP_MS = 80;
/** Bursts separated by at most this belong to one utterance ("oui oui oui"). Longer: a separate utterance. */
export const MAX_BURST_GAP_MS = 700;

/** Frame length assumed for the last sample when the interval can't be measured (expo-audio's rate). */
export const DEFAULT_FRAME_MS = 50;
/** One sample never covers more than this, so a metering hiccup can't inflate the voiced time. */
export const MAX_FRAME_MS = 250;

export interface EnvelopeSample {
  /** Time since the recording started, in ms. */
  tMs: number;
  /** Level in dBFS (−160…0). */
  db: number;
}

export interface Burst {
  startMs: number;
  endMs: number;
  durationMs: number;
  peakDb: number;
}

export interface EnvelopeAnalysis {
  /** Voiced time of the main utterance (sum of its bursts), in ms. */
  voicedMs: number;
  /** Number of separate voiced bursts in the main utterance. */
  bursts: number;
  /** Longest single burst of the main utterance: the length of a held "ouiiii". */
  longestBurstMs: number;
  noiseFloorDb: number;
  peakDb: number;
  /** Level at which a frame starts to count as voice. */
  thresholdDb: number;
  /** The main utterance's bursts, in time order. */
  segments: Burst[];
  /** Covered time from the first sample to the end of the last one. */
  totalMs: number;
  /** Voice was already present at the first sample (recording started late). */
  clippedStart: boolean;
  /** Voice was still present at the last sample (recording stopped early). */
  clippedEnd: boolean;
}

export interface EnvelopeOptions {
  noiseFloorPercentile?: number;
  minNoiseFloorDb?: number;
  voiceMarginDb?: number;
  hysteresisDb?: number;
  minBurstMs?: number;
  mergeGapMs?: number;
  maxBurstGapMs?: number;
  defaultFrameMs?: number;
  maxFrameMs?: number;
}

/** Web Audio helper: RMS amplitude (0…1) → dBFS, clamped to the metering range. */
export function rmsToDb(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return METER_MIN_DB;
  return clampDb(20 * Math.log10(rms));
}

function clampDb(db: number): number {
  if (db === -Infinity || Number.isNaN(db)) return METER_MIN_DB;
  return Math.min(METER_MAX_DB, Math.max(METER_MIN_DB, db));
}

/** Nearest-rank percentile (p in 0…100) of a non-empty list. */
export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)] as number;
}

function medianInterval(times: readonly number[], fallback: number): number {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const gap = (times[i] as number) - (times[i - 1] as number);
    if (gap > 0) gaps.push(gap);
  }
  return gaps.length === 0 ? fallback : percentile(gaps, 50);
}

function emptyAnalysis(): EnvelopeAnalysis {
  return {
    voicedMs: 0,
    bursts: 0,
    longestBurstMs: 0,
    noiseFloorDb: METER_MIN_DB,
    peakDb: METER_MIN_DB,
    thresholdDb: METER_MIN_DB,
    segments: [],
    totalMs: 0,
    clippedStart: false,
    clippedEnd: false,
  };
}

export function analyzeEnvelope(samples: readonly EnvelopeSample[], opts: EnvelopeOptions = {}): EnvelopeAnalysis {
  const o = {
    noiseFloorPercentile: opts.noiseFloorPercentile ?? NOISE_FLOOR_PERCENTILE,
    minNoiseFloorDb: opts.minNoiseFloorDb ?? MIN_NOISE_FLOOR_DB,
    voiceMarginDb: opts.voiceMarginDb ?? VOICE_MARGIN_DB,
    hysteresisDb: opts.hysteresisDb ?? HYSTERESIS_DB,
    minBurstMs: opts.minBurstMs ?? MIN_BURST_MS,
    mergeGapMs: opts.mergeGapMs ?? MERGE_GAP_MS,
    maxBurstGapMs: opts.maxBurstGapMs ?? MAX_BURST_GAP_MS,
    defaultFrameMs: opts.defaultFrameMs ?? DEFAULT_FRAME_MS,
    maxFrameMs: opts.maxFrameMs ?? MAX_FRAME_MS,
  };

  const frames = samples
    .filter((s) => Number.isFinite(s.tMs) && !Number.isNaN(s.db))
    .map((s) => ({ tMs: s.tMs, db: clampDb(s.db) }))
    .sort((a, b) => a.tMs - b.tMs);
  if (frames.length === 0) return emptyAnalysis();

  // Each frame covers [tMs, next tMs), capped; the last one gets the median interval.
  const times = frames.map((f) => f.tMs);
  const lastSpan = Math.min(o.maxFrameMs, medianInterval(times, o.defaultFrameMs));
  const ends = frames.map((f, i) => {
    const next = frames[i + 1];
    return f.tMs + (next ? Math.min(o.maxFrameMs, next.tMs - f.tMs) : lastSpan);
  });
  const firstMs = frames[0]!.tMs;
  const lastEndMs = ends[ends.length - 1] as number;

  const levels = frames.map((f) => f.db);
  const peakDb = Math.max(...levels);
  const noiseFloorDb = Math.max(o.minNoiseFloorDb, percentile(levels, o.noiseFloorPercentile));
  const onDb = noiseFloorDb + o.voiceMarginDb;
  const offDb = onDb - o.hysteresisDb;

  // 1. Hysteresis segmentation.
  const raw: Burst[] = [];
  let current: Burst | null = null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    const end = ends[i] as number;
    // A hole in the metering (a sample came late) ends the sound: its length is unknown.
    if (current !== null && i > 0 && f.tMs > (ends[i - 1] as number)) {
      raw.push(current);
      current = null;
    }
    if (current === null) {
      if (f.db >= onDb) current = { startMs: f.tMs, endMs: end, durationMs: 0, peakDb: f.db };
    } else if (f.db < offDb) {
      raw.push(current);
      current = null;
    } else {
      current.endMs = end;
      current.peakDb = Math.max(current.peakDb, f.db);
    }
  }
  if (current !== null) raw.push(current);

  // 2. Merge dips shorter than mergeGapMs, 3. drop clicks shorter than minBurstMs.
  const merged: Burst[] = [];
  for (const seg of raw) {
    const prev = merged[merged.length - 1];
    if (prev && seg.startMs - prev.endMs < o.mergeGapMs) {
      prev.endMs = seg.endMs;
      prev.peakDb = Math.max(prev.peakDb, seg.peakDb);
    } else {
      merged.push({ ...seg });
    }
  }
  const kept = merged
    .map((s) => ({ ...s, durationMs: s.endMs - s.startMs }))
    .filter((s) => s.durationMs >= o.minBurstMs);

  const base = {
    noiseFloorDb,
    peakDb,
    thresholdDb: onDb,
    totalMs: lastEndMs - firstMs,
  };
  if (kept.length === 0) {
    return { ...base, voicedMs: 0, bursts: 0, longestBurstMs: 0, segments: [], clippedStart: false, clippedEnd: false };
  }

  // 4. Group bursts into utterances; gaps up to maxBurstGapMs stay in one utterance.
  const groups: Burst[][] = [];
  for (const seg of kept) {
    const group = groups[groups.length - 1];
    const prev = group?.[group.length - 1];
    if (group && prev && seg.startMs - prev.endMs <= o.maxBurstGapMs) group.push(seg);
    else groups.push([seg]);
  }

  // 5. The main utterance: most voiced time, then loudest, then earliest.
  const voiced = (g: Burst[]) => g.reduce((sum, s) => sum + s.durationMs, 0);
  const loudest = (g: Burst[]) => Math.max(...g.map((s) => s.peakDb));
  let main = groups[0] as Burst[];
  for (const g of groups.slice(1)) {
    if (voiced(g) > voiced(main) || (voiced(g) === voiced(main) && loudest(g) > loudest(main))) main = g;
  }

  const first = main[0] as Burst;
  const last = main[main.length - 1] as Burst;
  return {
    ...base,
    voicedMs: voiced(main),
    bursts: main.length,
    longestBurstMs: Math.max(...main.map((s) => s.durationMs)),
    segments: main,
    clippedStart: first.startMs === firstMs,
    clippedEnd: last.endMs === lastEndMs,
  };
}
