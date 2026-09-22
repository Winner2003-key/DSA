// The book's own path to a name (GRAPH_SPECIFICATION.md §9).
// SQL mirror: dsa_solution_path(graph_id, secret_node_id).

import { answerClass } from './answers';
import type { GraphIndex } from './graph-index';
import { childPromptText, correctAnswerLabel, currentPrompt, decisionEdgeFor, startPosition } from './rules';
import type { PathStep, Position } from './types';

/** Only a malformed graph could loop; the book needs a few dozen steps. */
const MAX_STEPS = 500;

/**
 * The canonical way to the name, as the book teaches it: every spine question
 * with its correct code, then inside each section its children in book order,
 * answered NON until the one answered OUI, down to the card.
 *
 * It is exactly the walk an AI Découvreur makes against a truthful Tireur, with
 * no name calls, no detours and no back-steps — which is why it is what the end
 * screen shows, whatever happened during the game.
 *
 * The entries have the same shape as `GameEngine.revealedPath()`'s STEP entries,
 * so `PathGraph` draws them unchanged. The name itself is not appended: callers
 * already know the secret and add it as they do for a played path.
 */
export function solutionPath(ix: GraphIndex, secretNodeId: string): PathStep[] {
  const secret = ix.node(secretNodeId);
  if (!secret) return [];

  const steps: PathStep[] = [];
  let pos: Position = startPosition(ix);

  for (let i = 0; i < MAX_STEPS; i++) {
    if (pos.nodeId === secretNodeId) break;
    const prompt = currentPrompt(ix, pos);
    if (!prompt) break;

    const label = correctAnswerLabel(ix, prompt, secretNodeId);
    const cls = answerClass(label);

    if (prompt.kind === 'SPINE') {
      const edge = decisionEdgeFor(ix, prompt, label);
      // No branch of this question holds the secret: the graph cannot reach it.
      if (!edge) break;
      steps.push({
        kind: 'STEP',
        index: i,
        promptNodeId: prompt.promptNodeId,
        promptKind: 'SPINE',
        nodeType: ix.requireNode(prompt.promptNodeId).nodeType,
        text: prompt.text,
        answerLabel: edge.answerLabel,
        answerClass: answerClass(edge.answerLabel),
        targetText: childPromptText(ix.requireNode(edge.toNodeId)),
      });
      pos = { nodeId: edge.toNodeId, childCursor: 0 };
      continue;
    }

    steps.push({
      kind: 'STEP',
      index: i,
      promptNodeId: prompt.promptNodeId,
      promptKind: 'CHILD',
      nodeType: ix.requireNode(prompt.promptNodeId).nodeType,
      text: prompt.text,
      answerLabel: cls === 'OUI' ? 'OUI' : 'NON',
      answerClass: cls === 'OUI' ? 'OUI' : 'NON',
      targetText: null,
    });
    pos =
      cls === 'OUI'
        ? { nodeId: prompt.promptNodeId, childCursor: 0 }
        : { nodeId: pos.nodeId, childCursor: pos.childCursor + 1 };
  }

  return steps;
}
