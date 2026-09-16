import { describe, expect, it } from 'vitest';
import {
  GraphIndex,
  correctAnswer,
  correctAnswerLabel,
  currentPrompt,
  derivePosition,
  isCorrectName,
  isDeadEnd,
  startPosition,
} from '../src/index';
import type { GraphData, Prompt } from '../src/index';
import { E, KEYS, P, expectEngineError, mini, walk } from './helpers';

describe('rules', () => {
  const { ix, id, data } = mini();

  it('starts at ANCIEN after following the SYSTEM edge', () => {
    const pos = startPosition(ix);
    expect(pos).toEqual({ nodeId: id('ancien'), childCursor: 0 });
    expect(currentPrompt(ix, pos)).toEqual({ promptNodeId: id('ancien'), atNodeId: id('ancien'), text: 'ANCIEN', kind: 'SPINE', answerClasses: ['OUI', 'NON'] });
  });

  it('a QUESTION prompt allows the classes of its DECISION edges', () => {
    const { position } = walk(ix, ['OUI']);
    expect(currentPrompt(ix, position)?.answerClasses).toEqual(['OUI', 'JE_NE_SAIS_PAS']);
  });

  it('child prompt text is the label, or the clue for a CHARACTER', () => {
    const { position } = walk(ix, ['OUI', 'OUI', 'OUI']);
    expect(position).toEqual({ nodeId: id(P), childCursor: 0 });
    expect(currentPrompt(ix, position)).toMatchObject({ text: 'LIE A ADAM', kind: 'CHILD', atNodeId: id(P), answerClasses: ['OUI', 'NON'] });
    const inClass = walk(ix, ['OUI', 'OUI', 'OUI', 'OUI', 'OUI']).position;
    expect(currentPrompt(ix, inClass)?.text).toBe('Premier homme');
  });

  it('TOME is an ordinary question in book order', () => {
    const { position } = walk(ix, ['OUI', 'OUI', 'OUI', 'NON', 'OUI', 'NON']);
    expect(currentPrompt(ix, position)).toMatchObject({ text: 'TOME 1', kind: 'CHILD', promptNodeId: id(`${P}/lie-a-abraham/tome-1`) });
  });

  it('NON moves the cursor; past the last child is a dead end', () => {
    const { position } = walk(ix, ['OUI', 'OUI', 'NON', 'NON']);
    expect(currentPrompt(ix, position)).toBeNull();
    expect(isDeadEnd(ix, position)).toBe(true);
  });

  it('a CHARACTER reached by OUI has no prompt and is not a dead end', () => {
    const { position } = walk(ix, ['NON', 'OUI', 'OUI']);
    expect(position.nodeId).toBe(id(`${E}/le-sauveur--jesus-christ`));
    expect(currentPrompt(ix, position)).toBeNull();
    expect(isDeadEnd(ix, position)).toBe(false);
  });

  it('derivePosition rejects a step that does not answer the current prompt', () => {
    expectEngineError(() => derivePosition(ix, [{ index: 0, promptNodeId: id('ancien[oui]/homme'), answerLabel: 'OUI' }]), 'INVALID_STEP');
    expectEngineError(() => derivePosition(ix, [{ index: 0, promptNodeId: id('ancien'), answerLabel: 'JE NE SAIS PAS' }]), 'ANSWER_NOT_ALLOWED');
  });

  it('correctAnswer follows the branch containing the secret', () => {
    const david = id(KEYS.david);
    const root = currentPrompt(ix, startPosition(ix)) as Prompt;
    expect(correctAnswer(ix, root, david)).toBe('OUI');
    expect(correctAnswer(ix, root, id(KEYS.jesus))).toBe('NON');
    const pent = currentPrompt(ix, walk(ix, ['OUI', 'OUI']).position) as Prompt;
    expect(correctAnswer(ix, pent, david)).toBe('NON_REPETE');
    expect(correctAnswerLabel(ix, pent, david)).toBe('NONONONON');
    const child = currentPrompt(ix, walk(ix, ['OUI', 'OUI', 'OUI']).position) as Prompt;
    expect(correctAnswer(ix, child, id(KEYS.cain))).toBe('OUI');
    expect(correctAnswer(ix, child, id(KEYS.isaac))).toBe('NON');
    // Off the secret's path (JESUS-CHRIST, but ANCIEN answered OUI): no branch is true → NON when allowed.
    const offPath = currentPrompt(ix, walk(ix, ['OUI', 'OUI']).position) as Prompt;
    expect(correctAnswer(ix, offPath, id(KEYS.jesus))).toBe('NON');
    expect(correctAnswerLabel(ix, offPath, id(KEYS.jesus))).toBe('NON');
    // …and the last allowed class when NON is not an answer (HOMME after ANCIEN NON only has OUI).
    const onlyOui = currentPrompt(ix, walk(ix, ['NON']).position) as Prompt;
    expect(correctAnswer(ix, onlyOui, id(KEYS.cain))).toBe('OUI');
  });

  it('isCorrectName compares normalized card names; aliases do not count', () => {
    expect(isCorrectName(ix, 'Jésus Christ', id(KEYS.jesus))).toBe(true);
    expect(isCorrectName(ix, 'caïn', id(KEYS.cain))).toBe(true);
    expect(isCorrectName(ix, 'Abraham', id(KEYS.abram))).toBe(false);
    expect(isCorrectName(ix, 'ABRAM', id(KEYS.abram))).toBe(true);
    expect(isCorrectName(ix, '', id(KEYS.abram))).toBe(false);
  });

  it('GraphIndex hides non-APPROVED nodes and edges by default', () => {
    const cloned: GraphData = JSON.parse(JSON.stringify(data)) as GraphData;
    const edge = cloned.edges.find((e) => e.toNodeId === id(E));
    if (!edge) throw new Error('edge not found');
    edge.reviewStatus = 'NEEDS_REVIEW';
    const approved = new GraphIndex(cloned);
    expect(approved.playableCharacters()).toHaveLength(10);
    expect(approved.outgoing(id('ancien[non]/homme'))).toEqual([]);
    expect(new GraphIndex(cloned, { approvedOnly: false }).playableCharacters()).toHaveLength(13);
    expect(ix.playableCharacters().map((n) => n.label)).toEqual(['ADAM', 'CAÏN', 'ABRAHAM', 'ABRAM', 'ISMAËL', 'ISAAC', 'JOSUE', 'DAVID', 'JEROBOAM', 'ESDRAS', 'JESUS-CHRIST', 'JACQUES', 'JACQUES']);
    expect(ix.isAncestorOrSelf(id('ancien'), id(KEYS.cain))).toBe(true);
    expect(ix.isAncestorOrSelf(id(KEYS.cain), id('ancien'))).toBe(false);
  });
});
