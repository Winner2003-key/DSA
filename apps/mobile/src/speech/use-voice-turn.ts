/**
 * One spoken turn in a game: record (useVoiceCapture) → `transcribe` → hand the
 * words to the view, which decides what they mean. Owns the French states the
 * player sees (prêt, écoute, analyse, "J'ai entendu : « … »") and the fallbacks:
 * whatever goes wrong, a banner explains it (a voice game has no buttons: the
 * way out is a new game with Boutons).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  METER_MIN_DB,
  NOISE_FLOOR_PERCENTILE,
  TranscribeError,
  isLikelyHallucination,
  percentile,
  type DecisionEvidence,
  type EnvelopeSample,
  type VoiceDiagnostic,
} from '@dsa/voice';

import { fr } from '@/i18n/fr';
import type { Recording, RecorderErrorCode } from './recorder-types';
import { getTranscriber } from './transcriber';
import { useMicPermission, type MicPermissionHelp } from './use-mic-permission';
import { useVoiceCapture, type CapturePhase } from './use-voice-capture';

/** A hold shorter than this is a slip of the finger, not a word: nothing is sent. */
export const MIN_RECORDING_MS = 250;

export interface VoiceTurnOptions {
  /** Voice is chosen for this game and it is this player's turn. */
  enabled: boolean;
  /** The Whisper hint for this turn (`buildTranscribeHint`). */
  hint: () => string;
  /** The words that were heard, with the recording (the Tireur needs its envelope). */
  onTranscript: (text: string, recording: Recording) => Promise<void> | void;
}

export interface VoiceTurn {
  /** Voice can't be used on this device now (no microphone, not configured). */
  off: boolean;
  /**
   * The microphone was refused. Never latched: the microphone stays on the
   * screen, and the banner asks for the permission again.
   */
  micDenied: boolean;
  /** Asking again, and what to do when the browser has stopped asking. */
  micPermission: MicPermissionHelp;
  phase: CapturePhase;
  level: number;
  /** Slid up while holding: the recording goes on until the microphone is touched. */
  locked: boolean;
  /** What was understood, as said ("Ancien"). */
  heard: string | null;
  /** A short line under the button: "Je n'ai pas bien compris…". */
  notice: string | null;
  setNotice: (notice: string | null) => void;
  /** The fallback banner: voice failed. */
  fallback: string | null;
  dismissFallback: () => void;
  /**
   * The facts of the last turn, for « Réglages de la voix → Diagnostic ». Always
   * collected (it costs nothing); only shown when the setting is on.
   */
  diagnostic: VoiceDiagnostic | null;
  /**
   * The view says what it did with the words, in its own terms ("ANSWER OUI",
   * "GUESS Absalom"), which is the last line of the diagnostic.
   */
  reportOutcome: (outcome: string, evidence?: DecisionEvidence | null) => void;
  pressIn: () => void;
  pressOut: () => void;
  lock: () => void;
  tap: () => void;
}

/**
 * Loudest and quietest of the metering samples, for the diagnostic's `niveau`
 * line. The floor is the same percentile `analyzeEnvelope` uses, so the two
 * lines of the block cannot disagree about what counts as quiet.
 */
function levels(envelope: readonly EnvelopeSample[]): { peakDb: number | null; noiseFloorDb: number | null } {
  if (envelope.length === 0) return { peakDb: null, noiseFloorDb: null };
  const dbs = envelope.map((sample) => sample.db);
  return {
    peakDb: Math.max(METER_MIN_DB, ...dbs),
    noiseFloorDb: percentile(dbs, NOISE_FLOOR_PERCENTILE),
  };
}

/** "Ancien ?" → « Ancien » for the "J'ai entendu" line. */
export function cleanTranscript(text: string): string {
  return text.trim().replace(/^[\s.,;:!?…«»"]+|[\s.,;:!?…«»"]+$/gu, '');
}

/**
 * The server's own French for a failure, except where it says "ou utilise les
 * boutons": a voice game has none, and the banner says how to get them.
 */
function failureMessage(failure: TranscribeError | null): string {
  if (!failure) return fr.voice.serviceDown;
  switch (failure.code) {
    case 'DSA_VOICE_PROVIDER_FAILED':
      return fr.voice.serviceDown;
    case 'DSA_VOICE_RATE_LIMIT':
      return fr.voice.rateLimit;
    case 'DSA_VOICE_NETWORK':
      return fr.voice.offline;
    default:
      return failure.messageFr;
  }
}

export function useVoiceTurn(options: VoiceTurnOptions): VoiceTurn {
  const [heard, setHeard] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<VoiceDiagnostic | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [unsupportedSeen, setUnsupportedSeen] = useState(false);
  const latest = useRef(options);
  latest.current = options;

  // The player may allow the microphone from the browser's own panel while this
  // screen is up: the banner goes away by itself, no reload, no lost turn.
  const micPermission = useMicPermission({
    onGranted: () => {
      setMicDenied(false);
      setFallback(null);
    },
  });

  const onRecorderError = useCallback((code: RecorderErrorCode) => {
    // Nothing was recorded, so there are no facts but this one — and it is the
    // likeliest reason a voice game never starts.
    setDiagnostic({
      durationMs: 0,
      bytes: null,
      mimeType: '—',
      envelopeSamples: 0,
      peakDb: null,
      noiseFloorDb: null,
      serverMs: null,
      provider: null,
      errorCode: null,
      rawText: null,
      hallucination: false,
      outcome: `micro : ${code}`,
      evidence: null,
    });
    if (code === 'PERMISSION_DENIED') {
      // Not `off`: every press asks the browser again, which is the whole point.
      setMicDenied(true);
      setFallback(fr.voice.micDenied);
    } else if (code === 'UNAVAILABLE') {
      setOff(true);
      setFallback(fr.voice.micUnavailable);
    } else {
      setFallback(fr.voice.micFailed);
    }
  }, []);

  const onRecording = useCallback(async (recording: Recording) => {
    setHeard(null);
    setNotice(null);
    setMicDenied(false); // A recording arrived: the microphone is allowed after all.
    // The microphone's half of the diagnostic is known before anything is sent,
    // so a turn that never reaches the server still says how long it recorded.
    const report: VoiceDiagnostic = {
      durationMs: recording.durationMs,
      bytes: recording.audio.kind === 'blob' ? recording.audio.blob.size : null,
      mimeType: recording.mimeType,
      envelopeSamples: recording.envelope.length,
      ...levels(recording.envelope),
      serverMs: null,
      provider: null,
      errorCode: null,
      rawText: null,
      hallucination: false,
      outcome: null,
      evidence: null,
    };
    if (recording.durationMs < MIN_RECORDING_MS) {
      setDiagnostic({ ...report, outcome: 'trop court, rien envoyé' });
      setNotice(fr.voice.tooShort);
      return;
    }
    let text: string;
    const startedAt = Date.now();
    try {
      const result = await getTranscriber().transcribe(recording, {
        hint: latest.current.hint(),
        durationMs: recording.durationMs,
      });
      text = result.text;
      report.serverMs = Date.now() - startedAt;
      report.provider = result.provider;
      report.rawText = result.text;
    } catch (caught) {
      const failure = caught instanceof TranscribeError ? caught : null;
      report.serverMs = Date.now() - startedAt;
      report.errorCode = failure?.code ?? 'DSA_VOICE_INTERNAL';
      setDiagnostic(report);
      if (failure?.code === 'DSA_VOICE_NOT_CONFIGURED') setOff(true);
      setFallback(failureMessage(failure));
      return;
    }
    setFallback(null);
    // Silence and room tone come back from Whisper as subtitle credits, not as
    // an empty string ("Sous-titrage Société Radio-Canada", "Merci."). Showing
    // that as "J'ai entendu : « … »" is confusing, and the longer ones carry
    // enough letters to fuzzy-match a book name. It is handed on as nothing
    // said, so the view answers out loud like any other unrecognised turn — a
    // voice game has no buttons to read a silent notice from.
    const heardText = isLikelyHallucination(text) ? '' : cleanTranscript(text);
    report.hallucination = isLikelyHallucination(text);
    setDiagnostic(report);
    setHeard(heardText === '' ? null : heardText);
    await latest.current.onTranscript(heardText, recording);
  }, []);

  // Called by the view once it has decided; the turn's other facts are already in.
  const reportOutcome = useCallback((outcome: string, evidence: DecisionEvidence | null = null) => {
    setDiagnostic((current) => (current === null ? current : { ...current, outcome, evidence }));
  }, []);

  const capture = useVoiceCapture({
    enabled: options.enabled && !off,
    onRecording,
    onRecorderError,
  });

  // A refusal stored on an earlier visit: said before the player presses a
  // microphone that cannot open, with the way back in the same banner.
  useEffect(() => {
    if (!micPermission.blocked || !options.enabled) return;
    setMicDenied(true);
    setFallback((current) => current ?? fr.voice.micDenied);
  }, [micPermission.blocked, options.enabled]);

  // A new turn starts clean.
  useEffect(() => {
    if (!options.enabled) setNotice(null);
  }, [options.enabled]);

  // A new recording replaces what was heard last time.
  useEffect(() => {
    if (capture.phase === 'starting') {
      setHeard(null);
      setNotice(null);
    }
  }, [capture.phase]);

  return {
    off: off || !capture.supported,
    micDenied,
    micPermission,
    phase: capture.phase,
    level: capture.level,
    locked: capture.locked,
    heard,
    notice,
    setNotice,
    fallback: fallback ?? (!capture.supported && options.enabled && !unsupportedSeen ? fr.voice.micUnavailable : null),
    dismissFallback: () => {
      setFallback(null);
      setMicDenied(false);
      setUnsupportedSeen(true);
    },
    diagnostic,
    reportOutcome,
    pressIn: capture.pressIn,
    pressOut: capture.pressOut,
    lock: capture.lock,
    tap: capture.tap,
  };
}
