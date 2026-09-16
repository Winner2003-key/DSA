import type { PathEntry } from '@/services/types';

/** A refused name call, remembered by the device that saw it refused. */
export interface GuessRecord {
  /** How many answered steps existed when the name was called. */
  afterSteps: number;
  name: string;
}

/**
 * One question and the answer that belongs to it, or one name call and its answer.
 * The Découvreur's conversation is built only from these pairs, so a question can
 * never be shown next to another question's answer.
 */
export type Exchange =
  | { kind: 'QUESTION'; key: string; stepIndex: number; text: string; answerLabel: string }
  | { kind: 'GUESS'; key: string; name: string; answerLabel: 'NON' };

/**
 * The live path (never undone steps) interleaved with the refused name calls made
 * at each point. Calls made after steps that were later undone are dropped with them.
 */
export function buildExchanges(path: readonly PathEntry[], guesses: readonly GuessRecord[]): Exchange[] {
  const out: Exchange[] = [];
  const live = guesses.filter((g) => g.afterSteps <= path.length);
  const callsAt = (steps: number) =>
    live.forEach((g, i) => {
      if (g.afterSteps === steps) out.push({ kind: 'GUESS', key: `g${i}-${steps}`, name: g.name, answerLabel: 'NON' });
    });
  callsAt(0);
  path.forEach((entry, i) => {
    out.push({ kind: 'QUESTION', key: `q${entry.step_index}-${entry.node_id}`, stepIndex: entry.step_index, text: entry.text, answerLabel: entry.answer_label });
    callsAt(i + 1);
  });
  return out;
}

/** Keeps only the calls that still sit on the live path after a BACK or a REWIND. */
export function pruneGuesses(guesses: readonly GuessRecord[], pathLength: number): GuessRecord[] {
  return guesses.filter((g) => g.afterSteps <= pathLength);
}
