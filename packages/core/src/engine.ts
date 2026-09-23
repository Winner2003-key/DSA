import { answerClass } from './answers';
import { EngineError } from './errors';
import type { GraphIndex } from './graph-index';
import {
  childPromptText,
  correctAnswer,
  correctAnswerLabel,
  currentPrompt,
  decisionEdgeFor,
  isAnswerAllowed,
  isCorrectName,
  isDeadEnd,
  replaySteps,
  rewindTarget,
} from './rules';
import { normalizeName } from './normalize';
import type {
  DecouvreurAction,
  EngineMove,
  EngineState,
  GameStats,
  PathStep,
  Position,
  Prompt,
  Step,
} from './types';

export interface GameEngineOptions {
  rng?: () => number;
  now?: () => string;
}

/** Immutable game state machine. Every transition returns a new state. */
export class GameEngine {
  readonly ix: GraphIndex;
  private readonly rng: () => number;
  private readonly now: () => string;

  constructor(ix: GraphIndex, opts: GameEngineOptions = {}) {
    this.ix = ix;
    this.rng = opts.rng ?? Math.random;
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  newGame(secretNodeId?: string): EngineState {
    let secret = secretNodeId;
    if (secret === undefined) {
      const candidates = this.ix.playableCharacters();
      if (candidates.length === 0) throw new Error('No playable character in this graph');
      const pick = Math.min(candidates.length - 1, Math.floor(this.rng() * candidates.length));
      secret = (candidates[pick] as (typeof candidates)[number]).id;
    } else if (this.ix.node(secret)?.nodeType !== 'CHARACTER') {
      throw new Error(`Secret ${secret} is not a playable CHARACTER node`);
    }
    const at = this.now();
    return {
      status: 'PLAYING',
      awaiting: 'QUESTION',
      steps: [],
      undoneSteps: [],
      pendingGuess: null,
      moves: [{ type: 'SYSTEM', at, event: 'START', secretNodeId: secret }],
      secretNodeId: secret,
      startedAt: at,
      endedAt: null,
    };
  }

  // ---- derived views --------------------------------------------------------

  position(s: EngineState): Position {
    return replaySteps(this.ix, s.steps).position;
  }

  prompt(s: EngineState): Prompt | null {
    return currentPrompt(this.ix, this.position(s));
  }

  isDeadEnd(s: EngineState): boolean {
    return isDeadEnd(this.ix, this.position(s));
  }

  // ---- transitions -----------------------------------------------------------

  ask(s: EngineState): EngineState {
    this.assertPlaying(s);
    if (s.awaiting !== 'QUESTION') throw new EngineError('NOT_AWAITING_QUESTION');
    const prompt = this.prompt(s);
    if (!prompt) throw new EngineError('NO_PROMPT');
    return this.withMove({ ...s, awaiting: 'ANSWER' }, { type: 'QUESTION', at: this.now(), promptNodeId: prompt.promptNodeId, text: prompt.text });
  }

  answer(s: EngineState, label: string): EngineState {
    this.assertPlaying(s);
    if (s.awaiting !== 'ANSWER') throw new EngineError('NOT_AWAITING_ANSWER');
    const prompt = this.prompt(s);
    if (!prompt) throw new EngineError('NO_PROMPT');
    const answerLabel = label.trim();
    if (!isAnswerAllowed(this.ix, prompt, answerLabel)) {
      throw new EngineError('ANSWER_NOT_ALLOWED', `"${label}" is not allowed for "${prompt.text}"`);
    }
    const step: Step = { index: s.steps.length, promptNodeId: prompt.promptNodeId, answerLabel };
    const expectedClass = s.secretNodeId === null ? null : correctAnswer(this.ix, prompt, s.secretNodeId);
    return this.withMove(
      { ...s, awaiting: 'QUESTION', steps: [...s.steps, step] },
      {
        type: 'ANSWER',
        at: this.now(),
        stepIndex: step.index,
        promptNodeId: step.promptNodeId,
        answerLabel,
        answerClass: answerClass(answerLabel),
        expectedClass,
      },
    );
  }

  /** A name call is allowed whenever a question could be asked (including at a dead end or a CHARACTER). */
  guess(s: EngineState, name: string): EngineState {
    this.assertPlaying(s);
    if (s.awaiting !== 'QUESTION') throw new EngineError('NOT_AWAITING_QUESTION');
    const trimmed = name.trim();
    return this.withMove({ ...s, awaiting: 'GUESS_CONFIRM', pendingGuess: trimmed }, { type: 'GUESS', at: this.now(), name: trimmed });
  }

  confirmGuess(s: EngineState, label: 'OUI' | 'NON'): EngineState {
    this.assertPlaying(s);
    if (s.awaiting !== 'GUESS_CONFIRM' || s.pendingGuess === null) throw new EngineError('NOT_AWAITING_GUESS_CONFIRM');
    const cls = answerClass(label);
    if (cls !== 'OUI' && cls !== 'NON') throw new EngineError('ANSWER_NOT_ALLOWED', 'a name call is confirmed with OUI or NON');
    const at = this.now();
    const move: EngineMove = { type: 'GUESS_CONFIRM', at, name: s.pendingGuess, answerLabel: cls };
    if (cls === 'OUI') {
      return this.withMove({ ...s, status: 'DISCOVERED', awaiting: 'NONE', endedAt: at }, move);
    }
    return this.withMove({ ...s, awaiting: 'QUESTION', pendingGuess: null }, move);
  }

  /** Découvreur goes back to step k: keeps the first k steps; step k's question is asked again. */
  goBack(s: EngineState, stepIndex: number): EngineState {
    this.assertPlaying(s);
    if (s.awaiting === 'GUESS_CONFIRM' || s.awaiting === 'NONE') throw new EngineError('NOT_AWAITING_QUESTION');
    if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= s.steps.length) {
      throw new EngineError('INVALID_STEP', `cannot go back to step ${stepIndex} (${s.steps.length} steps)`);
    }
    return this.truncate(s, stepIndex, { type: 'BACK', at: this.now(), stepIndex, undoneCount: s.steps.length - stepIndex });
  }

  /**
   * Tireur says "QUESTION" ×count: back to the question that opened the list the
   * Découvreur is in, `count` levels up (GAME_RULES §4). Everything from that
   * question on is undone, and it is asked again.
   */
  rewind(s: EngineState, count: 1 | 2 | 3): EngineState {
    this.assertPlaying(s);
    if (s.awaiting === 'GUESS_CONFIRM' || s.awaiting === 'NONE') throw new EngineError('NOT_AWAITING_QUESTION');
    if (!Number.isInteger(count) || count < 1 || count > 3 || s.steps.length === 0) {
      throw new EngineError('INVALID_REWIND', `cannot rewind ${count} of ${s.steps.length} steps`);
    }
    const keep = rewindTarget(this.ix, s.steps, count);
    return this.truncate(s, keep, { type: 'REWIND', at: this.now(), count, undoneCount: s.steps.length - keep });
  }

  abandon(s: EngineState): EngineState {
    this.assertPlaying(s);
    return { ...s, status: 'ABANDONED', awaiting: 'NONE', endedAt: this.now() };
  }

  // ---- AI --------------------------------------------------------------------

  aiDecouvreurAction(s: EngineState): DecouvreurAction {
    this.assertPlaying(s);
    if (s.awaiting !== 'QUESTION') throw new EngineError('NOT_AWAITING_QUESTION');
    const { position: pos, prompts } = replaySteps(this.ix, s.steps);
    const node = this.ix.requireNode(pos.nodeId);
    if (node.nodeType === 'CHARACTER') {
      // If this name was already refused since reaching the leaf, re-ask the clue instead of looping.
      if (!this.nameRefusedSinceLastStep(s, node.label)) return { type: 'GUESS', name: node.label };
      return { type: 'BACK', stepIndex: s.steps.length - 1 };
    }
    if (currentPrompt(this.ix, pos)) return { type: 'ASK' };
    // Dead end: the NON answers that exhausted this list are not the mistake, so skip them first.
    const isNon = (i: number) => answerClass((s.steps[i] as Step).answerLabel) === 'NON';
    for (let i = s.steps.length - 1; i >= 0; i--) {
      if (isNon(i) && (prompts[i] as Prompt).atNodeId !== pos.nodeId) return { type: 'BACK', stepIndex: i };
    }
    for (let i = s.steps.length - 1; i >= 0; i--) {
      if (isNon(i)) return { type: 'BACK', stepIndex: i };
    }
    throw new EngineError('NO_PROMPT', 'dead end with no NON answer to go back to');
  }

  aiTireurAnswer(s: EngineState): string {
    this.assertPlaying(s);
    if (s.secretNodeId === null) throw new Error('No secret in this game');
    if (s.awaiting === 'GUESS_CONFIRM' && s.pendingGuess !== null) {
      return isCorrectName(this.ix, s.pendingGuess, s.secretNodeId) ? 'OUI' : 'NON';
    }
    if (s.awaiting !== 'ANSWER') throw new EngineError('NOT_AWAITING_ANSWER');
    const prompt = this.prompt(s);
    if (!prompt) throw new EngineError('NO_PROMPT');
    return correctAnswerLabel(this.ix, prompt, s.secretNodeId);
  }

  // ---- reveal and stats ------------------------------------------------------

  /** Steps that were not undone, then the discovered name (only when DISCOVERED). */
  revealedPath(s: EngineState): PathStep[] {
    const { prompts } = replaySteps(this.ix, s.steps);
    const path: PathStep[] = s.steps.map((step, i) => {
      const prompt = prompts[i] as Prompt;
      const target = prompt.kind === 'SPINE' ? decisionEdgeFor(this.ix, prompt, step.answerLabel) : null;
      return {
        kind: 'STEP',
        index: step.index,
        promptNodeId: step.promptNodeId,
        promptKind: prompt.kind,
        nodeType: this.ix.requireNode(step.promptNodeId).nodeType,
        text: prompt.text,
        answerLabel: step.answerLabel,
        answerClass: answerClass(step.answerLabel),
        targetText: target ? childPromptText(this.ix.requireNode(target.toNodeId)) : null,
      };
    });
    if (s.status === 'DISCOVERED' && s.secretNodeId !== null) {
      const secret = this.ix.requireNode(s.secretNodeId);
      const character = this.ix.characterOf(secret.id);
      path.push({ kind: 'NAME', nodeId: secret.id, name: secret.label, description: character?.description ?? secret.description });
    }
    return path;
  }

  stats(s: EngineState): GameStats {
    const stats: GameStats = { questions: 0, answers: 0, nonAnswers: 0, wrongAnswers: 0, guesses: 0, wrongGuesses: 0, rewinds: 0, backs: 0, durationMs: 0 };
    for (const m of s.moves) {
      switch (m.type) {
        case 'QUESTION':
          stats.questions++;
          break;
        case 'ANSWER':
          stats.answers++;
          if (m.answerClass === 'NON') stats.nonAnswers++;
          if (m.expectedClass !== null && m.expectedClass !== m.answerClass) stats.wrongAnswers++;
          break;
        case 'GUESS':
          stats.guesses++;
          break;
        case 'GUESS_CONFIRM':
          if (m.answerLabel === 'NON') stats.wrongGuesses++;
          break;
        case 'REWIND':
          stats.rewinds++;
          break;
        case 'BACK':
          stats.backs++;
          break;
        case 'SYSTEM':
          break;
      }
    }
    const end = Date.parse(s.endedAt ?? this.now());
    const start = Date.parse(s.startedAt);
    stats.durationMs = Number.isFinite(end - start) ? Math.max(0, end - start) : 0;
    return stats;
  }

  // ---- helpers ---------------------------------------------------------------

  private assertPlaying(s: EngineState): void {
    if (s.status !== 'PLAYING') throw new EngineError('GAME_OVER');
  }

  private withMove(s: EngineState, move: EngineMove): EngineState {
    return { ...s, moves: [...s.moves, move] };
  }

  private truncate(s: EngineState, keep: number, move: EngineMove): EngineState {
    return this.withMove(
      {
        ...s,
        awaiting: 'QUESTION',
        pendingGuess: null,
        steps: s.steps.slice(0, keep),
        undoneSteps: [...s.undoneSteps, ...s.steps.slice(keep)],
      },
      move,
    );
  }

  private nameRefusedSinceLastStep(s: EngineState, name: string): boolean {
    const target = normalizeName(name);
    for (let i = s.moves.length - 1; i >= 0; i--) {
      const m = s.moves[i] as EngineMove;
      if (m.type === 'ANSWER' || m.type === 'BACK' || m.type === 'REWIND') return false;
      if (m.type === 'GUESS_CONFIRM' && m.answerLabel === 'NON' && normalizeName(m.name) === target) return true;
    }
    return false;
  }
}
