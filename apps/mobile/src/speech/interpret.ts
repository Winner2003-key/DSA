/**
 * What a spoken turn means for the game. Pure functions, no React: the voice hooks
 * record and transcribe, these decide, and the views call the same `useGame`
 * actions as the buttons.
 */
import { matchIntent, type AnswerClass, type Prompt } from '@dsa/core';
import {
  analyzeEnvelope,
  classifySound,
  decideAnswer,
  type AnswerDecision,
  type Calibration,
  type CanonicalLabel,
  type EnvelopeSample,
  type SoundVerdict,
} from '@dsa/voice';

import type { GameState } from '@/services/types';

export type DecouvreurVoiceAction =
  | { kind: 'ASK' }
  | { kind: 'GUESS'; name: string }
  /** `stepIndex` null: "revenir" without a recognisable question — open the list. */
  | { kind: 'BACK'; stepIndex: number | null }
  | { kind: 'UNKNOWN' };

/** The state's prompt in the shape the core matcher reads (only `text` matters). */
function corePrompt(state: GameState): Prompt | null {
  if (!state.prompt) return null;
  return {
    promptNodeId: state.prompt.node_id,
    atNodeId: state.prompt.node_id,
    text: state.prompt.text,
    kind: 'CHILD',
    answerClasses: state.prompt.answer_classes,
  };
}

/**
 * The Découvreur spoke: "Ancien ?" asks the current question, "Absalom !" calls a
 * name, "revenir à Pentateuque" goes back on the path. Anything else is UNKNOWN,
 * including a different question than the one the book asks now.
 */
export function interpretDecouvreur(transcript: string, state: GameState, knownNames: readonly string[]): DecouvreurVoiceAction {
  const intent = matchIntent(transcript, {
    role: 'DECOUVREUR',
    prompt: corePrompt(state),
    answerLabels: [],
    knownNames: [...knownNames],
    path: state.path.map((entry) => ({ index: entry.step_index, text: entry.text })),
  });
  switch (intent.type) {
    case 'ASK':
      return state.prompt ? { kind: 'ASK' } : { kind: 'UNKNOWN' };
    case 'GUESS':
      return { kind: 'GUESS', name: intent.name };
    case 'BACK':
      if (state.path.length === 0) return { kind: 'UNKNOWN' };
      return { kind: 'BACK', stepIndex: intent.stepIndex ?? null };
    default:
      return { kind: 'UNKNOWN' };
  }
}

export interface TireurVoiceInput {
  transcript: string;
  envelope: readonly EnvelopeSample[];
  calibration: Calibration | null;
  /** The question's allowed classes, or null when a name call is waiting (OUI / NON only). */
  answerClasses: readonly AnswerClass[] | null;
}

/**
 * The Tireur spoke. The word comes from the transcript; OUI versus OUIOUIOUI comes
 * from the sound (`decideAnswer`). A name call only takes OUI or NON, and "question"
 * can't undo anything while a name waits for confirmation.
 */
export function interpretTireur(input: TireurVoiceInput): AnswerDecision {
  const guessCall = input.answerClasses === null;
  const decision = decideAnswer({
    allowedClasses: guessCall ? ['OUI', 'NON'] : input.answerClasses ?? [],
    transcript: input.transcript,
    envelope: input.envelope.length > 0 ? analyzeEnvelope(input.envelope) : null,
    calibration: input.calibration ?? undefined,
    role: 'TIREUR',
  });
  if (guessCall && decision.kind === 'REWIND') return { kind: 'UNKNOWN', evidence: decision.evidence };
  return decision;
}

/** The label a name call confirmation takes, or null for anything else. */
export function guessConfirmation(decision: AnswerDecision): 'OUI' | 'NON' | null {
  if (decision.kind !== 'ANSWER') return null;
  return decision.label === 'OUI' || decision.label === 'NON' ? decision.label : null;
}

/** Calibration's live test: the sound alone, with no words (nothing is sent to the server). */
export function soundVerdict(envelope: readonly EnvelopeSample[], calibration: Calibration): SoundVerdict {
  const analysis = analyzeEnvelope(envelope);
  // Without a transcript, several bursts are taken as the word repeated ("oui oui oui").
  const repeats = Math.max(1, analysis.bursts);
  return classifySound(analysis, calibration, { word: 'OUI', rewind: null, repeats, elongated: false, extraWords: false })
    .verdict;
}

export type { AnswerDecision, CanonicalLabel };
