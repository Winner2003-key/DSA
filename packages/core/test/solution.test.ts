// GRAPH_SPECIFICATION.md §9: the book's own path to a name.
import { describe, expect, it } from 'vitest';
import { applyAnswer, currentPrompt, solutionPath, startPosition } from '../src/index';
import type { GraphIndex, PathStep, Position } from '../src/index';
import { KEYS, mini } from './helpers';

/** Replays a solution path with the rules and returns where it lands. */
function follow(ix: GraphIndex, path: PathStep[]): Position {
  let pos = startPosition(ix);
  for (const step of path) {
    if (step.kind !== 'STEP') continue;
    const prompt = currentPrompt(ix, pos);
    expect(prompt, `no prompt before step ${step.index}`).not.toBeNull();
    expect(prompt!.promptNodeId).toBe(step.promptNodeId);
    expect(prompt!.text).toBe(step.text);
    pos = applyAnswer(ix, pos, prompt!, step.answerLabel);
  }
  return pos;
}

const shape = (path: PathStep[]) =>
  path.flatMap((p) => (p.kind === 'STEP' ? [`${p.text}=${p.answerLabel}`] : []));

describe('solutionPath', () => {
  it('is the book path to CAÏN: the spine, then the list read in order', () => {
    const { ix, id } = mini();
    expect(shape(solutionPath(ix, id(KEYS.cain)))).toEqual([
      'ANCIEN=OUI',
      'HOMME=OUI',
      'PENTATEUQUE=OUI',
      'LIE A ADAM=OUI',
      'CLASSE 1=OUI',
      'Premier homme=NON',
      'Le meurtrier=OUI',
    ]);
  });

  it('keeps the book codes on spine questions, not just OUI/NON', () => {
    const { ix, id } = mini();
    expect(shape(solutionPath(ix, id(KEYS.david)))).toEqual([
      'ANCIEN=OUI',
      'HOMME=OUI',
      'PENTATEUQUE=NONONONON',
      // LIE A DAVID is the section the code enters, so its first child is next.
      'LIVRE DE SAMUEL=OUIOUIOUI',
      "fils d'isaï=OUI",
    ]);
  });

  it('carries the same fields as a played path', () => {
    const { ix, id } = mini();
    const path = solutionPath(ix, id(KEYS.cain));
    for (const step of path) {
      expect(step.kind).toBe('STEP');
      if (step.kind !== 'STEP') continue;
      expect(Object.keys(step).sort()).toEqual(
        ['answerClass', 'answerLabel', 'index', 'kind', 'nodeType', 'promptKind', 'promptNodeId', 'targetText', 'text'].sort(),
      );
      // Only spine steps say what the answer entered — exactly like `path[]`.
      expect(step.targetText !== null).toBe(step.promptKind === 'SPINE');
    }
    expect(path.map((p) => (p.kind === 'STEP' ? p.index : -1))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('never names the card on the way: only the last step is its clue', () => {
    const { ix, id } = mini();
    for (const key of Object.values(KEYS)) {
      const secret = ix.requireNode(id(key));
      const path = solutionPath(ix, secret.id);
      const texts = path.flatMap((p) => (p.kind === 'STEP' ? [p.text] : []));
      expect(texts).not.toContain(secret.label);
      const targets = path.flatMap((p) => (p.kind === 'STEP' && p.targetText ? [p.targetText] : []));
      expect(targets).not.toContain(secret.label);
    }
  });

  it('leads to every playable card of the mini graph, and to that card only', () => {
    const { ix } = mini();
    const cards = ix.playableCharacters();
    expect(cards.length).toBe(13);
    for (const card of cards) {
      const path = solutionPath(ix, card.id);
      expect(path.length, `${card.label} has no path`).toBeGreaterThan(0);
      const landed = follow(ix, path);
      expect(landed.nodeId, `${card.label}: the path must land on the card`).toBe(card.id);
      // The last step is always the OUI that opens the card.
      const last = path[path.length - 1];
      expect(last?.kind === 'STEP' ? last.answerLabel : null).toBe('OUI');
    }
  });

  it('tells two people who share a name apart by their own clue', () => {
    const { ix, id } = mini();
    const alphee = shape(solutionPath(ix, id(KEYS.jacquesAlphee)));
    const zebedee = shape(solutionPath(ix, id(KEYS.jacquesZebedee)));
    expect(alphee).not.toEqual(zebedee);
    expect(alphee).toEqual(['ANCIEN=NON', 'HOMME=OUI', 'le sauveur=NON', "Fils d'Alphée=OUI"]);
    expect(zebedee).toEqual(['ANCIEN=NON', 'HOMME=OUI', 'le sauveur=NON', "Fils d'Alphée=NON", 'Fils de Zébédée=OUI']);
  });

  it('returns nothing for an unknown node', () => {
    const { ix } = mini();
    expect(solutionPath(ix, 'nope')).toEqual([]);
  });
});
