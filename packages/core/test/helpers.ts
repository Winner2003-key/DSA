import { expect } from 'vitest';
import { MINI_DIR, buildBookDir, MINI_BUILD_OPTIONS } from '../scripts/load-book';
import { EngineError, GameEngine, GraphIndex, applyAnswer, currentPrompt, startPosition } from '../src/index';
import type { EngineErrorCode, EngineState, Position, Step } from '../src/index';

export const P = 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes';
export const S = 'ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel';
export const E = 'ancien[non]/homme[oui]/les-evangiles';

export const KEYS = {
  cain: `${P}/lie-a-adam/classe-1/le-meurtrier--cain`,
  adam: `${P}/lie-a-adam/classe-1/premier-homme--adam`,
  abraham: `${P}/lie-a-abraham/pere-de-la-foi/plus-connu--abraham`,
  abram: `${P}/lie-a-abraham/pere-de-la-foi/moin-connu--abram`,
  isaac: `${P}/lie-a-abraham/tome-1/fils-de-la-promesse--isaac`,
  josue: 'ancien[oui]/homme[oui]/pentateuque[non]/les-3-premiers/serviteur-de-moise--josue',
  david: `${S}[ouioui]/lie-a-david/fils-d-isai--david`,
  jesus: `${E}/le-sauveur--jesus-christ`,
  jacquesAlphee: `${E}/fils-d-alphee--jacques`,
  jacquesZebedee: `${E}/fils-de-zebedee--jacques`,
} as const;

let cached: ReturnType<typeof buildBookDir> | null = null;

export function mini() {
  cached ??= buildBookDir('mini', MINI_DIR, MINI_BUILD_OPTIONS);
  const data = cached.data;
  const ix = new GraphIndex(data);
  let tick = 0;
  const engine = new GameEngine(ix, { now: () => new Date(Date.UTC(2026, 8, 15, 12, 0, tick++)).toISOString(), rng: () => 0 });
  const id = (key: string): string => {
    const n = ix.nodeByKey(key);
    if (!n) throw new Error(`no node ${key}`);
    return n.id;
  };
  return { data, ix, engine, id, report: cached.report };
}

/** Checks that the current prompt is `text`, then asks it and answers `label`. */
export function askAnswer(engine: GameEngine, s: EngineState, text: string, label: string): EngineState {
  expect(engine.prompt(s)?.text).toBe(text);
  return engine.answer(engine.ask(s), label);
}

export function playAll(engine: GameEngine, s: EngineState, seq: [string, string][]): EngineState {
  return seq.reduce((state, [text, label]) => askAnswer(engine, state, text, label), s);
}

export function expectEngineError(fn: () => unknown, code: EngineErrorCode): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    expect((e as EngineError).code).toBe(code);
    return;
  }
  throw new Error(`expected EngineError ${code}`);
}

/** Replays answer labels from START using the rules only. */
export function walk(ix: GraphIndex, labels: string[]): { steps: Step[]; position: Position } {
  const steps: Step[] = [];
  let position = startPosition(ix);
  for (const label of labels) {
    const prompt = currentPrompt(ix, position);
    if (!prompt) throw new Error(`no prompt before answering ${label}`);
    steps.push({ index: steps.length, promptNodeId: prompt.promptNodeId, answerLabel: label });
    position = applyAnswer(ix, position, prompt, label);
  }
  return { steps, position };
}
