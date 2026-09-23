/**
 * The end-of-game path, laid out like the book's mind maps (GRAPH_SPECIFICATION §8).
 * Paths come from the offline service, which runs the real rules on the mini graph,
 * so these are paths the game can actually produce.
 */
import { layoutPath, wrapText, fitRect, type LayoutNode, type PathLayout } from '@/graph/path-layout';
import { OfflineGameService } from '@/services/offline-game-service';
import type { PathEntry } from '@/services/types';

const P = 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes';

async function play(secretKey: string, answers: string[]): Promise<PathEntry[]> {
  const service = new OfflineGameService({ persist: false, secretNodeKey: secretKey });
  const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL' });
  // §9: every mode with a human Tireur starts in the preparation phase.
  await service.tireurReady(sessionId);
  for (const label of answers) {
    await service.ask(sessionId);
    await service.answer(sessionId, label);
  }
  return (await service.getState(sessionId)).path;
}

const CAIN_ANSWERS = ['OUI', 'OUI', 'OUI', 'OUI', 'OUI', 'NON', 'OUI'];

const byText = (layout: PathLayout, text: string): LayoutNode => {
  const node = layout.nodes.find((n) => n.text === text);
  if (!node) throw new Error(`no node "${text}" in ${layout.nodes.map((n) => n.text).join(', ')}`);
  return node;
};

const edgeBetween = (layout: PathLayout, from: LayoutNode, to: LayoutNode) => {
  const edge = layout.edges.find((e) => e.from === from.id && e.to === to.id);
  if (!edge) throw new Error(`no edge ${from.text} → ${to.text}`);
  return edge;
};

describe('layoutPath', () => {
  it('draws a spine step down, labelled, into the section named by target_text', async () => {
    const path = await play(`${P}/lie-a-adam/classe-1/le-meurtrier--cain`, CAIN_ANSWERS);
    const layout = layoutPath(path, { maxColumns: 3 });

    const ancien = byText(layout, 'ANCIEN');
    const homme = byText(layout, 'HOMME');
    const pentateuque = byText(layout, 'PENTATEUQUE');
    const section = byText(layout, 'PENTATEUQUE (HOMMES)');
    const lieAAdam = byText(layout, 'LIE A ADAM');

    expect([ancien.kind, homme.kind, pentateuque.kind]).toEqual(['QUESTION', 'QUESTION', 'QUESTION']);
    // A spine answer that leads to the next question does not draw that question twice.
    expect(layout.nodes.filter((n) => n.text === 'HOMME')).toHaveLength(1);

    expect(homme.y).toBeGreaterThan(ancien.y + ancien.height);
    expect(homme.column).toBe(ancien.column);
    expect(edgeBetween(layout, ancien, homme)).toMatchObject({ direction: 'down', answer: { label: 'OUI', cls: 'OUI' } });

    expect(section.kind).toBe('SECTION');
    expect(section.stepIndex).toBeNull();
    expect(section.y).toBeGreaterThan(pentateuque.y + pentateuque.height);
    expect(edgeBetween(layout, pentateuque, section)).toMatchObject({ direction: 'down', answer: { label: 'OUI' } });
    // The section's first item hangs below it, with no answer on that line.
    expect(lieAAdam.y).toBeGreaterThan(section.y + section.height);
    expect(edgeBetween(layout, section, lieAAdam)).toMatchObject({ direction: 'down', answer: null });
  });

  it('labels OUIOUIOUI and enters LIE A DAVID (scenario 4)', async () => {
    const path = await play('ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel[ouioui]/lie-a-david/fils-d-isai--david', [
      'OUI',
      'OUI',
      'NONONONON',
      'OUIOUIOUI',
    ]);
    const layout = layoutPath(path);
    const samuel = byText(layout, 'LIVRE DE SAMUEL');
    const david = byText(layout, 'LIE A DAVID');
    expect(david.kind).toBe('SECTION');
    expect(edgeBetween(layout, samuel, david).answer).toEqual({ label: 'OUIOUIOUI', cls: 'OUI_REPETE' });
    expect(edgeBetween(layout, byText(layout, 'PENTATEUQUE'), samuel).answer?.cls).toBe('NON_REPETE');
  });

  it('moves right on NON, and down on an OUI to a list item', async () => {
    const path = await play(`${P}/lie-a-abraham/tome-1/fils-de-la-promesse--isaac`, ['OUI', 'OUI', 'OUI', 'NON', 'OUI', 'NON', 'OUI']);
    const layout = layoutPath(path, { maxColumns: 3 });

    const adam = byText(layout, 'LIE A ADAM');
    const abraham = byText(layout, 'LIE A ABRAHAM');
    expect(abraham.y).toBe(adam.y);
    expect(abraham.column).toBe(adam.column + 1);
    expect(abraham.x).toBeGreaterThan(adam.x + adam.width);
    expect(edgeBetween(layout, adam, abraham)).toMatchObject({ direction: 'right', answer: { label: 'NON' } });

    const pere = byText(layout, 'PÈRE DE LA FOI');
    expect(pere.kind).toBe('GROUP');
    expect(pere.y).toBeGreaterThan(abraham.y + abraham.height);
    expect(pere.column).toBe(abraham.column);
    expect(edgeBetween(layout, abraham, pere)).toMatchObject({ direction: 'down', answer: { label: 'OUI' } });

    const tome = byText(layout, 'TOME 1');
    expect(tome.kind).toBe('GROUP');
    expect(edgeBetween(layout, pere, tome).direction).toBe('right');
  });

  it('wraps a long run of NON onto a new line instead of running off the screen', () => {
    const step = (text: string, answer: string) => ({
      text,
      answer_label: answer,
      prompt_kind: 'CHILD' as const,
      node_type: 'CHARACTER' as const,
      target_text: null,
    });
    const path = [
      { text: 'LES PETITS', answer_label: 'OUI', prompt_kind: 'SPINE' as const, node_type: 'QUESTION' as const, target_text: 'LA LISTE' },
      step('premier', 'NON'),
      step('deuxième', 'NON'),
      step('troisième', 'NON'),
      step('quatrième', 'NON'),
      step('cinquième', 'OUI'),
    ];
    const layout = layoutPath(path, { maxColumns: 2, name: { name: 'X', description: null } });
    const items = ['premier', 'deuxième', 'troisième', 'quatrième', 'cinquième'].map((t) => byText(layout, t));

    expect(Math.max(...layout.nodes.map((n) => n.column))).toBeLessThan(2);
    expect(items.map((n) => n.column)).toEqual([0, 1, 0, 1, 0]);
    expect(items[2]!.y).toBeGreaterThan(items[1]!.y + items[1]!.height);
    expect(edgeBetween(layout, items[1]!, items[2]!)).toMatchObject({ direction: 'wrap', answer: { label: 'NON' } });
    expect(edgeBetween(layout, items[1]!, items[2]!).points).toHaveLength(4);
    // Everything fits in two columns.
    const right = Math.max(...layout.nodes.map((n) => n.x + n.width));
    expect(right).toBeLessThanOrEqual(layout.width);
    expect(layout.width).toBeLessThan(500);
  });

  it('ends with the name, starred, reached by the last OUI; description only when given', async () => {
    const path = await play(`${P}/lie-a-adam/classe-1/le-meurtrier--cain`, CAIN_ANSWERS);
    const plain = layoutPath(path, { name: { name: 'CAÏN', description: null } });
    const last = plain.nodes[plain.nodes.length - 1]!;
    expect(last.kind).toBe('NAME');
    expect(last.lines.join(' ')).toContain('★ CAÏN');
    expect(last.descriptionLines).toEqual([]);
    expect(last.y).toBeGreaterThan(Math.max(...plain.nodes.slice(0, -1).map((n) => n.y)));
    const into = plain.edges[plain.edges.length - 1]!;
    expect(into).toMatchObject({ to: last.id, dashed: false, answer: { label: 'OUI' } });
    expect(plain.nodes.find((n) => n.text === 'Le meurtrier')!.id).toBe(into.from);

    const shared = layoutPath(path, { name: { name: 'CAÏN', description: 'Le meurtrier · LIE A ADAM' } });
    expect(shared.nodes[shared.nodes.length - 1]!.descriptionLines.join(' ')).toBe('Le meurtrier · LIE A ADAM');

    // Called early: the name hangs from the last node on a dashed line with no answer.
    const early = layoutPath(path.slice(0, 2), { name: { name: 'CAÏN', description: null } });
    expect(early.edges[early.edges.length - 1]).toMatchObject({ dashed: true, answer: null });
  });

  it('draws only what was walked: no node for unused branches or undone steps', async () => {
    const service = new OfflineGameService({ persist: false, secretNodeKey: `${P}/lie-a-adam/classe-1/le-meurtrier--cain` });
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL' });
    await service.tireurReady(sessionId);
    for (const label of ['OUI', 'OUI', 'OUI', 'NON']) {
      await service.ask(sessionId);
      await service.answer(sessionId, label);
    }
    // "QUESTION" ×1 re-opens the list: PENTATEUQUE is asked again, and the NON at
    // LIE A ADAM (plus the PENTATEUQUE step itself) is undone.
    await service.rewind(sessionId, 1);
    for (const label of ['OUI', 'OUI']) {
      await service.ask(sessionId);
      await service.answer(sessionId, label);
    }
    const path = (await service.getState(sessionId)).path;

    const layout = layoutPath(path);
    const texts = layout.nodes.map((n) => n.text);
    // CLASSE 1 is the question being asked now, not an answered step: it is not drawn.
    expect(texts).toEqual(['ANCIEN', 'HOMME', 'PENTATEUQUE', 'PENTATEUQUE (HOMMES)', 'LIE A ADAM']);
    for (const unused of ['LIE A ABRAHAM', 'CLASSE 1', 'LES 3 PREMIERS', 'LIVRE DE SAMUEL', 'LES EVANGILES', 'Le meurtrier', 'CAÏN']) {
      expect(texts).not.toContain(unused);
    }
    expect(layout.edges.every((e) => e.direction !== 'right')).toBe(true);
    // The last answer still shows, on a stub that leads to no node.
    const last = layout.edges[layout.edges.length - 1]!;
    expect(last).toMatchObject({ from: byText(layout, 'LIE A ADAM').id, to: null, direction: 'stub-down', answer: { label: 'OUI' } });
    // One beat per answered step, plus the first question.
    expect(layout.beats).toHaveLength(path.length + 1);
    expect(layout.beats.flatMap((b) => b.nodeIds).sort()).toEqual(layout.nodes.map((n) => n.id).sort());
  });

  it('handles an empty path', () => {
    expect(layoutPath([]).nodes).toEqual([]);
    expect(layoutPath([], { name: { name: 'ADAM', description: null } }).nodes.map((n) => n.kind)).toEqual(['NAME']);
  });
});

describe('helpers', () => {
  it('wraps on words and cuts a word longer than a line', () => {
    expect(wrapText('PENTATEUQUE (HOMMES)', 12)).toEqual(['PENTATEUQUE', '(HOMMES)']);
    expect(wrapText('ABCDEFGHIJ', 4)).toEqual(['ABCD', 'EFGH', 'IJ']);
  });

  it('fits a rectangle into a viewport and centres it', () => {
    const fit = fitRect({ x: 0, y: 0, width: 400, height: 200 }, { width: 200, height: 400 }, { padding: 0 });
    expect(fit.scale).toBeCloseTo(0.5);
    expect(fit.x).toBeCloseTo(0);
    expect(fit.y).toBeCloseTo(150);
  });
});
