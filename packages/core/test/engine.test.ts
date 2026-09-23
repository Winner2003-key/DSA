import { describe, expect, it } from 'vitest';
import { answerClass, correctAnswer } from '../src/index';
import type { EngineState, PathStep, Prompt } from '../src/index';
import { KEYS, askAnswer, expectEngineError, mini, playAll } from './helpers';

const stepsOf = (path: PathStep[]) => path.flatMap((p) => (p.kind === 'STEP' ? [[p.text, p.answerLabel]] : []));

const TO_PENTATEUQUE_OUI: [string, string][] = [
  ['ANCIEN', 'OUI'],
  ['HOMME', 'OUI'],
  ['PENTATEUQUE', 'OUI'],
];

describe('mini-graph scenarios', () => {
  it('1. secret CAÏN, normal play', () => {
    const { engine, id } = mini();
    const seq: [string, string][] = [...TO_PENTATEUQUE_OUI, ['LIE A ADAM', 'OUI'], ['CLASSE 1', 'OUI'], ['Premier homme', 'NON'], ['Le meurtrier', 'OUI']];
    let s = playAll(engine, engine.newGame(id(KEYS.cain)), seq);
    expect(engine.prompt(s)).toBeNull();
    s = engine.guess(s, 'caïn');
    expect(engine.aiTireurAnswer(s)).toBe('OUI');
    s = engine.confirmGuess(s, 'OUI');
    expect(s.status).toBe('DISCOVERED');
    expect(s.awaiting).toBe('NONE');
    const path = engine.revealedPath(s);
    expect(path).toHaveLength(8);
    expect(stepsOf(path)).toEqual(seq);
    expect(path[7]).toEqual({ kind: 'NAME', nodeId: id(KEYS.cain), name: 'CAÏN', description: 'Le meurtrier · LIE A ADAM' });
  });

  it('2. secret ABRAM: alias does not count, the card name does', () => {
    const { engine, id } = mini();
    let s = playAll(engine, engine.newGame(id(KEYS.abram)), [
      ...TO_PENTATEUQUE_OUI,
      ['LIE A ADAM', 'NON'],
      ['LIE A ABRAHAM', 'OUI'],
      ['PÈRE DE LA FOI', 'OUI'],
      ['plus connu', 'NON'],
      ['moin connu', 'OUI'],
    ]);
    s = engine.guess(s, 'Abraham');
    expect(engine.aiTireurAnswer(s)).toBe('NON');
    s = engine.confirmGuess(s, 'NON');
    expect(s.status).toBe('PLAYING');
    s = engine.guess(s, 'ABRAM');
    expect(engine.aiTireurAnswer(s)).toBe('OUI');
    expect(engine.confirmGuess(s, 'OUI').status).toBe('DISCOVERED');
  });

  it('3. secret ISAAC: TOME is a question', () => {
    const { engine, id } = mini();
    let s = playAll(engine, engine.newGame(id(KEYS.isaac)), [
      ...TO_PENTATEUQUE_OUI,
      ['LIE A ADAM', 'NON'],
      ['LIE A ABRAHAM', 'OUI'],
      ['PÈRE DE LA FOI', 'NON'],
      ['TOME 1', 'OUI'],
      ["FILS D'AGAR", 'NON'],
      ['FILS DE LA PROMESSE', 'OUI'],
    ]);
    s = engine.guess(s, 'Isaac');
    expect(engine.aiTireurAnswer(s)).toBe('OUI');
    expect(engine.confirmGuess(s, 'OUI').status).toBe('DISCOVERED');
  });

  it('4. secret DAVID: repeated codes, any repetition count', () => {
    const { engine, ix, id } = mini();
    const david = id(KEYS.david);
    let s = playAll(engine, engine.newGame(david), [['ANCIEN', 'OUI'], ['HOMME', 'OUI']]);
    s = engine.ask(s);
    expect(correctAnswer(ix, engine.prompt(s) as Prompt, david)).toBe('NON_REPETE');
    s = engine.answer(s, 'NONONO');
    expect(s.steps[2]?.answerLabel).toBe('NONONO');
    expect(engine.prompt(s)?.text).toBe('LIVRE DE SAMUEL');
    s = engine.ask(s);
    expect(correctAnswer(ix, engine.prompt(s) as Prompt, david)).toBe('OUI_REPETE');
    s = engine.answer(s, 'OUI OUI');
    s = askAnswer(engine, s, "fils d'isaï", 'OUI');
    s = engine.guess(s, 'DAVID');
    expect(engine.aiTireurAnswer(s)).toBe('OUI');
    s = engine.confirmGuess(s, 'OUI');
    expect(s.status).toBe('DISCOVERED');
    expect(engine.revealedPath(s).map((p) => (p.kind === 'STEP' ? p.answerClass : 'NAME'))).toEqual(['OUI', 'OUI', 'NON_REPETE', 'OUI_REPETE', 'OUI', 'NAME']);
  });

  it('5. secret JESUS-CHRIST: name normalization', () => {
    const { engine, id } = mini();
    let s = playAll(engine, engine.newGame(id(KEYS.jesus)), [['ANCIEN', 'NON'], ['HOMME', 'OUI'], ['le sauveur', 'OUI']]);
    s = engine.guess(s, 'Jésus Christ');
    expect(engine.aiTireurAnswer(s)).toBe('OUI');
    expect(engine.confirmGuess(s, 'OUI').status).toBe('DISCOVERED');
  });

  it('6. a name can be called at any time', () => {
    const { engine, id } = mini();
    let s = engine.newGame(id(KEYS.cain));
    s = engine.guess(s, 'David');
    expect(engine.aiTireurAnswer(s)).toBe('NON');
    s = engine.confirmGuess(s, 'NON');
    expect(engine.prompt(s)?.text).toBe('ANCIEN');
    expect(s.status).toBe('PLAYING');
    expect(s.awaiting).toBe('QUESTION');
    expect(s.pendingGuess).toBeNull();
  });

  const mistake = (): { s: EngineState } & ReturnType<typeof mini> => {
    const m = mini();
    const s = playAll(m.engine, m.engine.newGame(m.id(KEYS.cain)), [...TO_PENTATEUQUE_OUI, ['LIE A ADAM', 'NON']]);
    expect(m.engine.prompt(s)?.text).toBe('LIE A ABRAHAM');
    return { ...m, s };
  };

  it('7. Tireur "QUESTION" ×1 goes back to the question that opened the list', () => {
    // A wrong NON on a sibling never entered a level, so ×1 re-opens the list
    // itself: PENTATEUQUE, not the previous question (GAME_RULES §4).
    const { engine, s: afterMistake } = mistake();
    let s = engine.rewind(afterMistake, 1);
    expect(engine.prompt(s)?.text).toBe('PENTATEUQUE');
    expect(s.steps).toHaveLength(2);
    expect(s.undoneSteps).toEqual(afterMistake.steps.slice(2));
    // The pair asks down again and gets it right this time.
    s = askAnswer(engine, s, 'PENTATEUQUE', 'OUI');
    s = playAll(engine, s, [['LIE A ADAM', 'OUI'], ['CLASSE 1', 'OUI'], ['Premier homme', 'NON'], ['Le meurtrier', 'OUI']]);
    s = engine.confirmGuess(engine.guess(s, 'CAÏN'), 'OUI');
    const steps = stepsOf(engine.revealedPath(s));
    expect(steps).toContainEqual(['LIE A ADAM', 'OUI']);
    expect(steps).not.toContainEqual(['LIE A ADAM', 'NON']);
    expect(engine.stats(s)).toMatchObject({ rewinds: 1, backs: 0, questions: 9, answers: 9, nonAnswers: 2, wrongAnswers: 1, guesses: 1, wrongGuesses: 0 });
    expect(engine.stats(s).durationMs).toBeGreaterThan(0);
  });

  it('7b. QUESTION ×1 inside a list re-asks the question that opened it', () => {
    // The owner's first example: "1ère classe ?" OUI, then two NON inside it.
    // ×1 re-asks CLASSE 1 itself; NON then moves to the next sibling.
    const { engine, id } = mini();
    const inClasse1 = playAll(engine, engine.newGame(id(KEYS.cain)), [
      ...TO_PENTATEUQUE_OUI,
      ['LIE A ADAM', 'OUI'],
      ['CLASSE 1', 'OUI'],
      ['Premier homme', 'NON'],
      ['Le meurtrier', 'NON'],
    ]);
    expect(engine.prompt(inClasse1)).toBeNull(); // past the last child of CLASSE 1
    const s = engine.rewind(inClasse1, 1);
    expect(engine.prompt(s)?.text).toBe('CLASSE 1');
    expect(s.steps).toHaveLength(4);
    expect(s.undoneSteps).toHaveLength(3);
    // NON on CLASSE 1 now walks to the next sibling of the list above.
    const next = engine.answer(engine.ask(s), 'NON');
    expect(engine.prompt(next)).toBeNull(); // CLASSE 1 is the only child of LIE A ADAM
    expect(engine.rewind(next, 1).steps).toHaveLength(3);
    expect(engine.prompt(engine.rewind(next, 1))?.text).toBe('LIE A ADAM');
  });

  it('8. Tireur "QUESTION" ×2 goes one list higher, ×3 higher still', () => {
    const { engine, s: afterMistake } = mistake();
    const two = engine.rewind(afterMistake, 2);
    expect(engine.prompt(two)?.text).toBe('HOMME');
    expect(two.steps).toHaveLength(1);
    expect(two.undoneSteps).toHaveLength(3);

    const three = engine.rewind(afterMistake, 3);
    expect(engine.prompt(three)?.text).toBe('ANCIEN');
    expect(three.steps).toHaveLength(0);
    expect(three.undoneSteps).toHaveLength(4);
    expect(engine.stats(three)).toMatchObject({ rewinds: 1 });
  });

  it('8b. right after a spine answer, ×1 re-asks that spine question', () => {
    const { engine, id } = mini();
    const s = playAll(engine, engine.newGame(id(KEYS.cain)), TO_PENTATEUQUE_OUI);
    expect(engine.prompt(s)?.text).toBe('LIE A ADAM');
    const back = engine.rewind(s, 1);
    expect(engine.prompt(back)?.text).toBe('PENTATEUQUE');
    expect(back.steps).toHaveLength(2);
  });

  it('8c. fewer entering steps than asked: back to the very first question', () => {
    const { engine, id } = mini();
    // One step only: ×2 and ×3 cannot find a second level, so they go to step 0.
    const one = playAll(engine, engine.newGame(id(KEYS.cain)), [['ANCIEN', 'OUI']]);
    for (const n of [1, 2, 3] as const) {
      const s = engine.rewind(one, n);
      expect(engine.prompt(s)?.text).toBe('ANCIEN');
      expect(s.steps).toHaveLength(0);
      expect(s.undoneSteps).toHaveLength(1);
    }
    // Two NON inside the same list are not levels either: ×3 lands on ANCIEN.
    const deep = playAll(engine, engine.newGame(id(KEYS.cain)), [
      ...TO_PENTATEUQUE_OUI,
      ['LIE A ADAM', 'NON'],
      ['LIE A ABRAHAM', 'NON'],
    ]);
    expect(engine.prompt(engine.rewind(deep, 3))?.text).toBe('ANCIEN');
  });

  it('8d. a rewind after a wrong name call keeps the name call out of the levels', () => {
    const { engine, id } = mini();
    let s = playAll(engine, engine.newGame(id(KEYS.cain)), [...TO_PENTATEUQUE_OUI, ['LIE A ADAM', 'OUI']]);
    s = engine.confirmGuess(engine.guess(s, 'ADAM'), 'NON');
    expect(engine.prompt(s)?.text).toBe('CLASSE 1');
    // The refused name is not a step, so ×1 is still "the question that opened this list".
    const back = engine.rewind(s, 1);
    expect(engine.prompt(back)?.text).toBe('LIE A ADAM');
    expect(back.steps).toHaveLength(3);
    expect(back.pendingGuess).toBeNull();
    expect(engine.stats(back)).toMatchObject({ rewinds: 1, guesses: 1, wrongGuesses: 1 });
  });

  it('9. Découvreur goes back after a dead end', () => {
    const { engine, id } = mini();
    let s = playAll(engine, engine.newGame(id(KEYS.cain)), [['ANCIEN', 'OUI'], ['HOMME', 'OUI'], ['PENTATEUQUE', 'NON'], ['Serviteur de MOÏSE', 'NON']]);
    expect(engine.prompt(s)).toBeNull();
    expect(engine.isDeadEnd(s)).toBe(true);
    expect(engine.aiDecouvreurAction(s)).toEqual({ type: 'BACK', stepIndex: 2 });
    const before = s;
    s = engine.goBack(s, 2);
    expect(engine.prompt(s)?.text).toBe('PENTATEUQUE');
    expect(s.undoneSteps).toEqual(before.steps.slice(2));
    expect(s.undoneSteps.map((st) => st.promptNodeId)).toEqual([id('ancien[oui]/homme[oui]/pentateuque'), id(KEYS.josue)]);
    s = askAnswer(engine, s, 'PENTATEUQUE', 'OUI');
    expect(engine.revealedPath(s).map((p) => (p.kind === 'STEP' ? p.text : ''))).toEqual(['ANCIEN', 'HOMME', 'PENTATEUQUE']);
    expect(engine.stats(s).backs).toBe(1);
  });

  it('10. answer validation', () => {
    const { engine, id } = mini();
    let s = playAll(engine, engine.newGame(id(KEYS.cain)), [['ANCIEN', 'OUI']]);
    // HOMME accepts JE NE SAIS PAS.
    const homme = engine.answer(engine.ask(s), 'JE NE SAIS PAS');
    expect(engine.prompt(homme)?.text).toBe('VERSÉ DANS LES ÉCRITURES');
    // PENTATEUQUE rejects it.
    s = askAnswer(engine, s, 'HOMME', 'OUI');
    const asked = engine.ask(s);
    expectEngineError(() => engine.answer(asked, 'JE NE SAIS PAS'), 'ANSWER_NOT_ALLOWED');
    // A child prompt only takes OUI/NON.
    s = engine.answer(asked, 'OUI');
    expect(engine.prompt(s)?.text).toBe('LIE A ADAM');
    expectEngineError(() => engine.answer(engine.ask(s), 'OUI OUI OUI'), 'ANSWER_NOT_ALLOWED');
    s = playAll(engine, s, [['LIE A ADAM', 'OUI']]);
    expect(s.steps).toHaveLength(4);
    // INVALID_REWIND is now only about N and an empty path.
    expectEngineError(() => engine.rewind(s, 4 as 3), 'INVALID_REWIND');
    expectEngineError(() => engine.rewind(s, 0 as 1), 'INVALID_REWIND');
    expectEngineError(() => engine.rewind(engine.newGame(id(KEYS.cain)), 1), 'INVALID_REWIND');
    // More levels asked for than exist is not an error: it goes back to the start.
    const short = playAll(engine, engine.newGame(id(KEYS.cain)), [['ANCIEN', 'OUI']]);
    expect(engine.rewind(short, 2).steps).toHaveLength(0);
  });

  it('11. AI Tireur + AI Découvreur discover every playable secret with correct answers', () => {
    const { engine, ix } = mini();
    const secrets = ix.playableCharacters();
    expect(secrets).toHaveLength(13);
    for (const secret of secrets) {
      let s = engine.newGame(secret.id);
      for (let guard = 0; s.status === 'PLAYING'; guard++) {
        expect(guard).toBeLessThan(100);
        const action = engine.aiDecouvreurAction(s);
        if (action.type === 'ASK') {
          s = engine.ask(s);
          const label = engine.aiTireurAnswer(s);
          expect(answerClass(label)).toBe(correctAnswer(ix, engine.prompt(s) as Prompt, secret.id));
          s = engine.answer(s, label);
        } else if (action.type === 'GUESS') {
          s = engine.guess(s, action.name);
          s = engine.confirmGuess(s, engine.aiTireurAnswer(s) as 'OUI' | 'NON');
        } else {
          s = engine.goBack(s, action.stepIndex);
        }
      }
      expect(s.status).toBe('DISCOVERED');
      expect(engine.stats(s)).toMatchObject({ wrongAnswers: 0, wrongGuesses: 0, backs: 0, rewinds: 0 });
      const last = engine.revealedPath(s).at(-1);
      expect(last).toMatchObject({ kind: 'NAME', nodeId: secret.id });
    }
  });
});

describe('engine transitions and errors', () => {
  it('is immutable', () => {
    const { engine, id } = mini();
    const s0 = engine.newGame(id(KEYS.cain));
    const snapshot = JSON.stringify(s0);
    const s1 = engine.answer(engine.ask(s0), 'OUI');
    expect(JSON.stringify(s0)).toBe(snapshot);
    expect(s1.steps).toHaveLength(1);
    expect(s1).not.toBe(s0);
  });

  it('newGame picks a playable secret with rng', () => {
    const { engine, ix } = mini();
    expect(engine.newGame().secretNodeId).toBe(ix.playableCharacters()[0]?.id);
    expect(() => engine.newGame(ix.nodeByKey('ancien')?.id)).toThrow();
  });

  it('typed error codes', () => {
    const { engine, id } = mini();
    const s = engine.newGame(id(KEYS.jesus));
    expectEngineError(() => engine.ask(engine.ask(s)), 'NOT_AWAITING_QUESTION');
    expectEngineError(() => engine.answer(s, 'OUI'), 'NOT_AWAITING_ANSWER');
    expectEngineError(() => engine.confirmGuess(s, 'OUI'), 'NOT_AWAITING_GUESS_CONFIRM');
    expectEngineError(() => engine.goBack(s, 0), 'INVALID_STEP');
    expectEngineError(() => engine.aiTireurAnswer(s), 'NOT_AWAITING_ANSWER');
    expectEngineError(() => engine.guess(engine.guess(s, 'X'), 'Y'), 'NOT_AWAITING_QUESTION');
    const atLeaf = playAll(engine, s, [['ANCIEN', 'NON'], ['HOMME', 'OUI'], ['le sauveur', 'OUI']]);
    expectEngineError(() => engine.ask(atLeaf), 'NO_PROMPT');
    expectEngineError(() => engine.goBack(atLeaf, 3), 'INVALID_STEP');
    const won = engine.confirmGuess(engine.guess(atLeaf, 'JESUS-CHRIST'), 'OUI');
    expectEngineError(() => engine.ask(won), 'GAME_OVER');
    expectEngineError(() => engine.guess(won, 'X'), 'GAME_OVER');
    expectEngineError(() => engine.rewind(won, 1), 'GAME_OVER');
  });

  it('AI Découvreur re-asks the clue after its name call at a leaf was refused', () => {
    const { engine, id } = mini();
    // Human Tireur wrongly says OUI to "Premier homme" with secret CAÏN.
    let s = playAll(engine, engine.newGame(id(KEYS.cain)), [...TO_PENTATEUQUE_OUI, ['LIE A ADAM', 'OUI'], ['CLASSE 1', 'OUI'], ['Premier homme', 'OUI']]);
    expect(engine.aiDecouvreurAction(s)).toEqual({ type: 'GUESS', name: 'ADAM' });
    s = engine.confirmGuess(engine.guess(s, 'ADAM'), engine.aiTireurAnswer(engine.guess(s, 'ADAM')) as 'NON');
    expect(engine.aiDecouvreurAction(s)).toEqual({ type: 'BACK', stepIndex: 5 });
  });
});
