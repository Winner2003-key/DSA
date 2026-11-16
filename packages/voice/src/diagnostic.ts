// What happened on the last spoken turn, in one block the player can read out
// to whoever is fixing it.
//
// A voice game has no buttons, so every failure in the chain — a refused
// microphone, a 300 ms hold, a missing secret, a Groq 429, a transcript the
// matcher does not know — reaches the player as the same sentence: « Je n'ai pas
// bien compris ». That is right for a player mid-game and useless for anybody
// trying to find out why. This is the same turn, told in facts.
//
// Off by default, turned on in « Réglages de la voix ». Nothing here decides
// anything; it only reports. It holds no audio and no key.

import type { DecisionEvidence } from './answer-decision';
import type { TranscribeErrorCode, TranscribeProvider } from './transcribe-client';

export interface VoiceDiagnostic {
  // --- the microphone ---
  /** Length of the recording, by the recording clock. */
  durationMs: number;
  /** Size of the upload when the platform knows it (the web does, the phone does not). */
  bytes: number | null;
  mimeType: string;
  /** Metering samples collected — zero means the envelope could not be measured. */
  envelopeSamples: number;

  // --- the server ---
  /** Round trip measured by the app, including the upload. */
  serverMs: number | null;
  provider: TranscribeProvider | null;
  /** Set instead of `provider` when the call failed. */
  errorCode: TranscribeErrorCode | null;

  // --- what came back ---
  /** The transcript as the provider wrote it, before any cleaning. */
  rawText: string | null;
  /** It was subtitle boilerplate, so it was handed on as nothing said. */
  hallucination: boolean;

  // --- what the game did ---
  /** The view's own words for the action it took ("ANSWER OUI", "GUESS Absalom"). */
  outcome: string | null;
  /** The Tireur's decision, when there was one. */
  evidence: DecisionEvidence | null;
}

export interface DiagnosticLine {
  label: string;
  value: string;
}

function ms(value: number): string {
  return `${Math.round(value)} ms`;
}

/**
 * The block, one line per step of the chain, so the first line that looks wrong
 * is the one to chase. French: the players read it.
 */
export function formatDiagnostic(d: VoiceDiagnostic): DiagnosticLine[] {
  const lines: DiagnosticLine[] = [];

  const micro = [ms(d.durationMs), `${d.envelopeSamples} mesures`, d.mimeType];
  if (d.bytes !== null) micro.push(`${(d.bytes / 1024).toFixed(1)} ko`);
  lines.push({ label: 'micro', value: micro.join(' · ') });

  if (d.errorCode !== null) {
    lines.push({ label: 'serveur', value: [d.errorCode, d.serverMs === null ? null : ms(d.serverMs)].filter(Boolean).join(' · ') });
    return lines;
  }
  if (d.provider !== null || d.serverMs !== null) {
    lines.push({ label: 'serveur', value: [d.provider ?? '—', d.serverMs === null ? null : ms(d.serverMs)].filter(Boolean).join(' · ') });
  }

  if (d.rawText !== null) {
    lines.push({ label: 'texte', value: d.rawText === '' ? '(vide)' : `« ${d.rawText} »` });
  }
  if (d.hallucination) {
    lines.push({ label: 'bavardage', value: 'texte du générique : ignoré' });
  }

  if (d.evidence !== null) {
    const e = d.evidence;
    lines.push({ label: 'lecture', value: [e.word ?? '—', `via ${e.via}`, `×${e.transcriptRepeats}`].join(' · ') });
    lines.push({
      label: 'son',
      value: [`${ms(e.soundMs)} sur ${ms(e.thresholdMs)}`, `${e.bursts} salve${e.bursts === 1 ? '' : 's'}`, e.verdict ?? '—'].join(' · '),
    });
  }
  if (d.outcome !== null) {
    lines.push({ label: 'jeu', value: [d.outcome, d.evidence?.reason].filter(Boolean).join(' · ') });
  }
  return lines;
}
