// The single place the game rules live (GRAPH_SPECIFICATION.md §2, traversal rules).
// The SQL implementation mirrors this file.

import { answerClass, sameAnswer } from './answers';
import { EngineError } from './errors';
import type { GraphIndex } from './graph-index';
import { normalizeName } from './normalize';
import type { AnswerClass, GraphEdge, GraphNode, Position, Prompt, Step } from './types';

/** Follows SYSTEM edges (START → ANCIEN) until a node that asks something. */
function followSystem(ix: GraphIndex, nodeId: string): string {
  let current = nodeId;
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(current)) return current;
    seen.add(current);
    const out = ix.outgoing(current);
    const first = out[0];
    if (out.length !== 1 || first === undefined || first.edgeKind !== 'SYSTEM') return current;
    current = first.toNodeId;
  }
}

export function startPosition(ix: GraphIndex): Position {
  return { nodeId: followSystem(ix, ix.start().id), childCursor: 0 };
}

function decisionEdges(ix: GraphIndex, nodeId: string): GraphEdge[] {
  return ix.outgoing(nodeId).filter((e) => e.edgeKind === 'DECISION');
}

function uniqueClasses(edges: GraphEdge[]): AnswerClass[] {
  const classes: AnswerClass[] = [];
  for (const e of edges) {
    const c = answerClass(e.answerLabel);
    if (!classes.includes(c)) classes.push(c);
  }
  return classes;
}

/** Text asked for a child: its label, or its clue for a CHARACTER. */
export function childPromptText(child: GraphNode): string {
  return child.nodeType === 'CHARACTER' && child.question !== null && child.question.trim() !== ''
    ? child.question
    : child.label;
}

/** The prompt at a position; null means dead end or CHARACTER reached. */
export function currentPrompt(ix: GraphIndex, pos: Position): Prompt | null {
  const node = ix.node(pos.nodeId);
  if (!node) return null;
  switch (node.nodeType) {
    case 'QUESTION': {
      const edges = decisionEdges(ix, node.id);
      if (edges.length === 0) return null;
      return { promptNodeId: node.id, atNodeId: node.id, text: node.label, kind: 'SPINE', answerClasses: uniqueClasses(edges) };
    }
    case 'CATEGORY':
    case 'GROUP': {
      const edge = ix.outgoing(node.id)[pos.childCursor];
      if (!edge) return null;
      const child = ix.requireNode(edge.toNodeId);
      return { promptNodeId: child.id, atNodeId: node.id, text: childPromptText(child), kind: 'CHILD', answerClasses: ['OUI', 'NON'] };
    }
    default:
      return null;
  }
}

/** Answer labels a Tireur can give at a prompt (canonical edge labels for SPINE). */
export function answerLabelsFor(ix: GraphIndex, prompt: Prompt): string[] {
  if (prompt.kind === 'CHILD') return ['OUI', 'NON'];
  return decisionEdges(ix, prompt.promptNodeId).map((e) => e.answerLabel);
}

/** The DECISION edge an answer label selects at a SPINE prompt, if any. */
export function decisionEdgeFor(ix: GraphIndex, prompt: Prompt, label: string): GraphEdge | null {
  if (prompt.kind !== 'SPINE') return null;
  return decisionEdges(ix, prompt.promptNodeId).find((e) => sameAnswer(e.answerLabel, label)) ?? null;
}

export function isAnswerAllowed(ix: GraphIndex, prompt: Prompt, label: string): boolean {
  if (prompt.kind === 'CHILD') {
    const c = answerClass(label);
    return c === 'OUI' || c === 'NON';
  }
  return decisionEdgeFor(ix, prompt, label) !== null;
}

/** Moves from a position by answering its prompt. Throws ANSWER_NOT_ALLOWED. */
export function applyAnswer(ix: GraphIndex, pos: Position, prompt: Prompt, label: string): Position {
  if (prompt.kind === 'SPINE') {
    const edge = decisionEdgeFor(ix, prompt, label);
    if (!edge) throw new EngineError('ANSWER_NOT_ALLOWED', `"${label}" is not an answer to "${prompt.text}"`);
    return { nodeId: edge.toNodeId, childCursor: 0 };
  }
  const c = answerClass(label);
  if (c === 'OUI') return { nodeId: prompt.promptNodeId, childCursor: 0 };
  if (c === 'NON') return { nodeId: pos.nodeId, childCursor: pos.childCursor + 1 };
  throw new EngineError('ANSWER_NOT_ALLOWED', `"${label}" is not OUI or NON`);
}

export interface Replay {
  position: Position;
  /** prompts[i] is the prompt answered by steps[i]. */
  prompts: Prompt[];
}

/** Replays answered steps from START. Throws INVALID_STEP or ANSWER_NOT_ALLOWED. */
export function replaySteps(ix: GraphIndex, steps: Step[]): Replay {
  let position = startPosition(ix);
  const prompts: Prompt[] = [];
  steps.forEach((step, i) => {
    const prompt = currentPrompt(ix, position);
    if (!prompt) throw new EngineError('INVALID_STEP', `step ${i}: no prompt at this position`);
    if (prompt.promptNodeId !== step.promptNodeId) {
      throw new EngineError('INVALID_STEP', `step ${i}: expected prompt ${prompt.promptNodeId}, got ${step.promptNodeId}`);
    }
    prompts.push(prompt);
    position = applyAnswer(ix, position, prompt, step.answerLabel);
  });
  return { position, prompts };
}

export function derivePosition(ix: GraphIndex, steps: Step[]): Position {
  return replaySteps(ix, steps).position;
}

// ---------------------------------------------------------------------------
// "QUESTION" ×N — going back to the question that opened a list (GAME_RULES §4).
//
// This is the single definition of what "a level" means; the SQL mirror is
// dsa_replay / dsa_entering_steps / dsa_rewind_target.

/**
 * A step **enters a level** when it moves the pair one list deeper: a spine
 * answer (a DECISION edge always moves), or a child prompt answered OUI.
 * A child prompt answered NON only walks to the next sibling of the same list.
 */
export function entersLevel(prompt: Prompt, answerLabel: string): boolean {
  if (prompt.kind === 'SPINE') return true;
  return answerClass(answerLabel) === 'OUI';
}

/** Indices of the steps that entered a level, in ascending order. */
export function enteringStepIndices(ix: GraphIndex, steps: Step[]): number[] {
  const { prompts } = replaySteps(ix, steps);
  const entering: number[] = [];
  steps.forEach((step, i) => {
    if (entersLevel(prompts[i] as Prompt, step.answerLabel)) entering.push(i);
  });
  return entering;
}

/**
 * How many steps "QUESTION" ×count keeps: the index of the count-th most recent
 * entering step, so that its own question is the one asked again. With fewer
 * than `count` entering steps the pair goes back to the very first question (0).
 */
export function rewindTarget(ix: GraphIndex, steps: Step[], count: number): number {
  const entering = enteringStepIndices(ix, steps);
  return entering[entering.length - count] ?? 0;
}

/** No prompt and not on a CHARACTER: the Découvreur must go back. */
export function isDeadEnd(ix: GraphIndex, pos: Position): boolean {
  if (currentPrompt(ix, pos) !== null) return false;
  return ix.node(pos.nodeId)?.nodeType !== 'CHARACTER';
}

/**
 * The truthful DECISION edge at a SPINE prompt: the one leading to an ancestor-or-self of the secret.
 * null when no branch contains the secret (the game is already off the secret's path).
 */
export function correctDecisionEdge(ix: GraphIndex, prompt: Prompt, secretNodeId: string): GraphEdge | null {
  if (prompt.kind !== 'SPINE') return null;
  return decisionEdges(ix, prompt.promptNodeId).find((e) => ix.isAncestorOrSelf(e.toNodeId, secretNodeId)) ?? null;
}

/**
 * Truthful answer class. SPINE: class of the branch containing the secret. CHILD: OUI if the
 * child contains the secret. Off the secret's path at a SPINE prompt, NON if allowed (else the
 * last allowed class), since no branch is true.
 */
export function correctAnswer(ix: GraphIndex, prompt: Prompt, secretNodeId: string): AnswerClass {
  if (prompt.kind === 'CHILD') return ix.isAncestorOrSelf(prompt.promptNodeId, secretNodeId) ? 'OUI' : 'NON';
  const edge = correctDecisionEdge(ix, prompt, secretNodeId);
  if (edge) return answerClass(edge.answerLabel);
  if (prompt.answerClasses.includes('NON')) return 'NON';
  return prompt.answerClasses[prompt.answerClasses.length - 1] ?? 'NON';
}

/** Truthful answer as a label the engine accepts (canonical edge label for SPINE prompts). */
export function correctAnswerLabel(ix: GraphIndex, prompt: Prompt, secretNodeId: string): string {
  if (prompt.kind === 'CHILD') return correctAnswer(ix, prompt, secretNodeId);
  const edge = correctDecisionEdge(ix, prompt, secretNodeId);
  if (edge) return edge.answerLabel;
  const cls = correctAnswer(ix, prompt, secretNodeId);
  const fallback = decisionEdges(ix, prompt.promptNodeId).find((e) => answerClass(e.answerLabel) === cls);
  return fallback ? fallback.answerLabel : cls;
}

/** A name call is correct only for the exact card name (aliases don't count). */
export function isCorrectName(ix: GraphIndex, name: string, secretNodeId: string): boolean {
  const secret = ix.node(secretNodeId);
  if (!secret) return false;
  const n = normalizeName(name);
  return n !== '' && n === normalizeName(secret.label);
}
