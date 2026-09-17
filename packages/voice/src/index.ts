export {
  METER_MIN_DB,
  METER_MAX_DB,
  NOISE_FLOOR_PERCENTILE,
  MIN_NOISE_FLOOR_DB,
  VOICE_MARGIN_DB,
  HYSTERESIS_DB,
  MIN_BURST_MS,
  MERGE_GAP_MS,
  MAX_BURST_GAP_MS,
  DEFAULT_FRAME_MS,
  MAX_FRAME_MS,
  analyzeEnvelope,
  rmsToDb,
  percentile,
} from './envelope';
export type { EnvelopeSample, EnvelopeAnalysis, EnvelopeOptions, Burst } from './envelope';

export {
  CALIBRATION_THRESHOLD_FLOOR_MS,
  CALIBRATION_MIN_SEPARATION_MS,
  DEFAULT_SHORT_MS,
  DEFAULT_LONG_MS,
  DEFAULT_CALIBRATION,
  calibrate,
  median,
  parseCalibration,
  soundLengthMs,
} from './calibration';
export type { Calibration, CalibrationQuality } from './calibration';

export { BORDERLINE_RATIO, CANONICAL_LABELS, classifySound, decideAnswer, readTranscript } from './answer-decision';
export type {
  AnswerDecision,
  AnswerWord,
  CanonicalLabel,
  DecideAnswerInput,
  DecisionEvidence,
  DecisionReason,
  SoundVerdict,
  TranscriptReading,
} from './answer-decision';

export { FREE_TALK_MAX_MS, FREE_TALK_SILENCE_MS, detectEndOfSpeech } from './endpoint';
export type { EndOfSpeech, EndOfSpeechOptions } from './endpoint';

export { LEXICON_FR } from './lexicon.fr';
export type { PronunciationLexicon } from './lexicon.fr';
export { cardinalFr, ordinalFr, readOrdinalToken } from './numbers.fr';
export { speakableAnswer, speakableName, speakablePrompt, speakableText } from './speakable';

export {
  TRANSCRIBE_FUNCTION_NAME,
  TRANSCRIBE_MAX_AUDIO_BYTES,
  TRANSCRIBE_MAX_AUDIO_MS,
  TRANSCRIBE_MAX_HINT_CHARS,
  TRANSCRIBE_HINT_TARGET_CHARS,
  TRANSCRIBE_HINT_MAX_NAMES,
  TRANSCRIBE_AUDIO_TYPES,
  TRANSCRIBE_FIELDS,
  TRANSCRIBE_NETWORK_MESSAGE_FR,
  TranscribeError,
  buildTranscribeHint,
  createTranscribeClient,
  parseTranscribeError,
  parseTranscribeResult,
  transcribeUrl,
} from './transcribe-client';
export type {
  FormDataLike,
  SpeechToText,
  TranscribeClientConfig,
  TranscribeErrorBody,
  TranscribeErrorCode,
  TranscribeHintOptions,
  TranscribeOptions,
  TranscribeProvider,
  TranscribeResult,
  TranscribeWord,
} from './transcribe-client';
