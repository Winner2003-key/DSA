import { describe, expect, it } from 'vitest';
import { buildGraphData, parsePage, parseSpine, validateGraph } from '../src/index';
import type { GraphData, GraphNode } from '../src/index';

const SPINE = `# test spine
START DSA
  DÉBUT -> QUESTION ANCIEN @p2
    OUI -> QUESTION HOMME @p2 @p5 {note: spine node note}
      OUI {note: edge note} -> CATEGORY SECTION A @p5
      NONONONON {variants: NONONONO@27, NONONONON@32} -> CATEGORY SECTION B @p27
      CODE INCONNU (JOB) {review: R6a no code} -> CATEGORY LIE A JOB @p63
    NON -> CATEGORY NOUVEAU
`;

const A = 'ancien[oui]/homme[oui]/section-a';
const B = 'ancien[oui]/homme[nonnon]/section-b';

const node = (data: GraphData, key: string): GraphNode => {
  const n = data.nodes.find((x) => x.nodeKey === key);
  if (!n) throw new Error(`no node ${key}; keys: ${data.nodes.map((x) => x.nodeKey).join(', ')}`);
  return n;
};
const childKeys = (data: GraphData, key: string) =>
  data.edges
    .filter((e) => e.fromNodeId === node(data, key).id)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((e) => (data.nodes.find((n) => n.id === e.toNodeId) as GraphNode).nodeKey);

describe('parseSpine', () => {
  it('parses answers, types, labels, tags on both sides and @p lists', () => {
    const spine = parseSpine(SPINE, 'spine.dsa');
    expect(spine.errors).toEqual([]);
    const homme = spine.root?.children[0]?.children[0];
    expect(homme).toMatchObject({ line: 4, answerLabel: 'OUI', nodeType: 'QUESTION', label: 'HOMME', pages: [2, 5], nodeTags: [{ name: 'note', value: 'spine node note' }] });
    const job = homme?.children[2];
    expect(job).toMatchObject({ answerLabel: 'CODE INCONNU (JOB)', label: 'LIE A JOB', edgeTags: [{ name: 'review', value: 'R6a no code' }], pages: [63] });
  });

  it('builds spine keys, SYSTEM/DECISION edges, variants, pages and review', () => {
    const { data, report } = buildGraphData('t', parseSpine(SPINE, 'spine.dsa'), [], { defaultReviewStatus: 'APPROVED', allowUnsalted: true });
    expect(report.errors).toEqual([]);
    expect(data.nodes.map((n) => n.nodeKey)).toEqual(['dsa', 'ancien', 'ancien[oui]/homme', A, B, 'ancien[oui]/homme[code-inconnu-job]/lie-a-job', 'ancien[non]/nouveau']);
    expect(data.edges[0]).toMatchObject({ edgeKind: 'SYSTEM', answerLabel: 'DÉBUT', orderIndex: 0 });
    expect(node(data, 'ancien[oui]/homme')).toMatchObject({ sourcePage: 2, metadata: { extra_pages: [5], notes: ['spine node note'] } });
    const toB = data.edges.find((e) => e.toNodeId === node(data, B).id);
    expect(toB).toMatchObject({ edgeKind: 'DECISION', answerLabel: 'NONONONON', orderIndex: 1, sourcePage: 27, metadata: { source_variants: [{ label: 'NONONONO', page: 27 }, { label: 'NONONONON', page: 32 }] } });
    expect(data.edges.find((e) => e.toNodeId === node(data, A).id)?.metadata.notes).toEqual(['edge note']);
    const toJob = data.edges.find((e) => e.answerLabel === 'CODE INCONNU (JOB)');
    expect(toJob).toMatchObject({ reviewStatus: 'NEEDS_REVIEW', reviewNote: 'R6a no code' });
    expect(report.warnings.filter((w) => w.code === 'EMPTY_CATEGORY')).toHaveLength(4);
  });

  it('reports errors with file and line numbers', () => {
    const bad = `START DSA
  DÉBUT -> QUESTION ANCIEN
    OUI QUESTION HOMME
   NON -> CATEGORY X
    NON -> WHATEVER X
\tOUI -> CATEGORY Y
        OUI -> CATEGORY TOO DEEP
  NON {oops} -> CATEGORY Z
`;
    const messages = parseSpine(bad, 'bad-spine.dsa').errors.map((e) => e.message);
    expect(messages).toEqual([
      'bad-spine.dsa:4: odd indentation (3 spaces; use multiples of 2)',
      'bad-spine.dsa:6: tab in indentation (use 2 spaces)',
      'bad-spine.dsa:3: expected "ANSWER -> TYPE LABEL"',
      'bad-spine.dsa:5: expected "TYPE LABEL" after "->" with TYPE in QUESTION|CATEGORY|GROUP|CHARACTER|REFERENCE|END',
      'bad-spine.dsa:7: indentation jumps from level 2 to 4',
      'bad-spine.dsa:8: unknown tag {oops}',
    ]);
  });
});

describe('parsePage', () => {
  it('parses directives, tags, clue • NAME with parentheses, commas and apostrophes, and all separators', () => {
    const page = parsePage(
      `@page 15
@printed 14
@attach ${A}
# comment line
LES ENFANTS (A, B) {variant: A... LES ENFANTS} {note: voir p16 # pas un commentaire} {review: O1: ordre à confirmer} # trailing comment
  L'aîné (le premier), dit-on • RUBEN @p16
  Le prisonnier · SIMEON
  Le violent * LEVI {note: x}
  • SANS-INDICE
  CLASSE 2 {classe}
    1er • DAN
`,
      'p015.dsa',
    );
    expect(page.errors).toEqual([]);
    expect(page).toMatchObject({ page: 15, printed: 14 });
    const root = page.attaches[0]?.items[0];
    expect(root).toMatchObject({
      line: 5,
      kind: 'CATEGORY',
      label: 'LES ENFANTS (A, B)',
      tags: [
        { name: 'variant', value: 'A... LES ENFANTS' },
        { name: 'note', value: 'voir p16 # pas un commentaire' },
        { name: 'review', value: 'O1: ordre à confirmer' },
      ],
    });
    expect(root?.children.map((c) => [c.kind, c.clue, c.label])).toEqual([
      ['CHARACTER', "L'aîné (le premier), dit-on", 'RUBEN'],
      ['CHARACTER', 'Le prisonnier', 'SIMEON'],
      ['CHARACTER', 'Le violent', 'LEVI'],
      ['CHARACTER', null, 'SANS-INDICE'],
      ['CATEGORY', null, 'CLASSE 2'],
    ]);
    expect(root?.children[0]?.pages).toEqual([16]);
    expect(root?.children[4]?.groupKind).toBe('CLASSE');
  });

  it('reports errors with file and line numbers', () => {
    const page = parsePage(
      `@page 9
ORPHAN LINE
@attach x/y
GOOD
  Clue • NAME
    Child of character • BAD
  {unclosed
  A • B • C
  Tagged {tome} • NAME
  NOTE {note}
@foo bar
  Clue {same-as: x} • OK
  CAT {same-as: x}
`,
      'p009.dsa',
    );
    expect(page.errors.map((e) => e.message)).toEqual([
      'p009.dsa:2: item before any @attach',
      'p009.dsa:6: a CHARACTER (NAME, line 5) cannot have children',
      'p009.dsa:7: unbalanced "{" or "}"',
      'p009.dsa:8: several "•" separators on one line',
      'p009.dsa:9: a CHARACTER cannot be a group ({classe}/{tome}/{alias}/{group})',
      'p009.dsa:10: tag {note} needs a value',
      'p009.dsa:11: unknown directive @foo',
      'p009.dsa:13: {same-as} is only allowed on a CHARACTER line (clue • NAME)',
    ]);
    expect(parsePage('# nothing', 'empty.dsa').errors.map((e) => e.message)).toEqual(['empty.dsa:1: missing @page', 'empty.dsa:1: missing @attach']);
  });
});

describe('buildGraphData', () => {
  const spine = parseSpine(SPINE, 'spine.dsa');

  it('attaches across pages: order = page number, then line order; attach targets from other pages resolve', () => {
    const p30 = parsePage(`@page 30\n@attach ${A}\n\nFROM PAGE 30\n  Clue • ZED\n@attach ${A}/from-page-10\nLATE CHILD OF P10\n  Indice • LATE\n`, 'p030.dsa');
    const p10 = parsePage(`@page 10\n@attach ${A}\n\nFROM PAGE 10\n  Premier • ALPHA\nSECOND ON 10\n  Deuxième • BETA\n`, 'p010.dsa');
    const p8 = parsePage(`@page 8\n@attach ${A}/second-on-10\n\nEarly • GAMMA\n`, 'p008.dsa');
    const { data, report } = buildGraphData('t', spine, [p30, p10, p8], { defaultReviewStatus: 'APPROVED', allowUnsalted: true });
    expect(report.errors).toEqual([]);
    expect(childKeys(data, A)).toEqual([`${A}/from-page-10`, `${A}/second-on-10`, `${A}/from-page-30`]);
    expect(childKeys(data, `${A}/from-page-10`)).toEqual([`${A}/from-page-10/premier--alpha`, `${A}/from-page-10/late-child-of-p10`]);
    // p8 attaches under a node that p10 defines; nested child (p10) comes after the p8 child.
    expect(childKeys(data, `${A}/second-on-10`)).toEqual([`${A}/second-on-10/early--gamma`, `${A}/second-on-10/deuxieme--beta`]);
    expect(node(data, `${A}/from-page-10`)).toMatchObject({ sourcePage: 10, nodeType: 'CATEGORY' });
    expect(validateGraph(data).errors.filter((e) => e.code !== 'NO_OUTGOING')).toEqual([]);
  });

  it('reports unresolved attaches and invalid targets with file:line', () => {
    const p1 = parsePage(`@page 1\n\n@attach nowhere/at-all\nX\n`, 'p001.dsa');
    const p2 = parsePage(`@page 2\n@attach ancien[oui]/homme\nY\n`, 'p002.dsa');
    const { report } = buildGraphData('t', spine, [p1, p2], { allowUnsalted: true });
    expect(report.errors.map((e) => [e.code, e.message])).toEqual([
      ['INVALID_ATTACH_TARGET', 'p002.dsa:3: "Y" cannot be a child of QUESTION ancien[oui]/homme (only CATEGORY and GROUP have ordered children)'],
      ['UNRESOLVED_ATTACH', 'p001.dsa:3: @attach nowhere/at-all does not match any node'],
    ]);
  });

  it('ALIAS groups share one character; descriptions use the nearest CATEGORY; review and defaults', () => {
    const page = parsePage(
      `@page 11
@printed 10
@attach ${A}
LIE A ABRAHAM {variant: II LIE A ABRAHAM}
  TOME 1 {tome}
    PÈRE DE LA FOI {alias} {review: floating}
      plus connu • ABRAHAM
      moin connu • ABRAM
    FILS D'AGAR • ISMAËL {note: n1}
`,
      'p011.dsa',
    );
    const { data, report } = buildGraphData('t', spine, [page], { allowUnsalted: true });
    expect(report.errors).toEqual([]);
    const base = `${A}/lie-a-abraham/tome-1`;
    const abraham = node(data, `${base}/pere-de-la-foi/plus-connu--abraham`);
    const abram = node(data, `${base}/pere-de-la-foi/moin-connu--abram`);
    const ismael = node(data, `${base}/fils-d-agar--ismael`);
    expect(abram.characterId).toBe(abraham.characterId);
    expect(data.characters).toHaveLength(2);
    const shared = data.characters.find((c) => c.id === abraham.characterId);
    expect(shared).toMatchObject({ name: 'ABRAHAM', aliases: ['ABRAM'], description: 'PÈRE DE LA FOI · LIE A ABRAHAM', gender: null, testament: null });
    expect(abram).toMatchObject({ question: 'moin connu', metadata: { qualifier: 'moin connu', printed_page: 10 }, description: 'PÈRE DE LA FOI · LIE A ABRAHAM' });
    expect(ismael).toMatchObject({ description: "FILS D'AGAR · LIE A ABRAHAM", reviewStatus: 'NEEDS_REVIEW', reviewNote: null, metadata: { notes: ['n1'], printed_page: 10 } });
    expect(node(data, `${A}/lie-a-abraham`).metadata.variants).toEqual(['II LIE A ABRAHAM']);
    expect(node(data, `${base}/pere-de-la-foi`)).toMatchObject({ nodeType: 'GROUP', reviewStatus: 'NEEDS_REVIEW', reviewNote: 'floating', metadata: { group_kind: 'ALIAS' } });
    const approved = buildGraphData('t', spine, [page], { defaultReviewStatus: 'APPROVED', allowUnsalted: true }).data;
    expect(node(approved, `${base}/fils-d-agar--ismael`).reviewStatus).toBe('APPROVED');
    expect(node(approved, `${base}/pere-de-la-foi`).reviewStatus).toBe('NEEDS_REVIEW');
    expect(approved.edges.find((e) => e.toNodeId === node(approved, `${base}/pere-de-la-foi`).id)?.reviewStatus).toBe('NEEDS_REVIEW');
  });

  it('{same-as} shares a character; {key} overrides keys; unresolved same-as is reported', () => {
    const p16 = parsePage(`@page 16\n@attach ${A}\nLES JUMEAUX\n  1er • PERETS\n`, 'p016.dsa');
    const p26 = parsePage(
      `@page 26\n@attach ${B}\nGENEALOGIE {key: custom/genealogie}\n  Fils de JUDA {same-as: ${A}/les-jumeaux/1er--perets} • PERETS\n  Autre nom {same-as: ${A}/les-jumeaux/1er--perets} • PHARES\n  Perdu {same-as: nope} • X\n`,
      'p026.dsa',
    );
    const { data, report } = buildGraphData('t', spine, [p26, p16], { allowUnsalted: true });
    expect(report.errors.map((e) => e.message)).toEqual(['p026.dsa:6: {same-as: nope} does not match a CHARACTER node']);
    const original = node(data, `${A}/les-jumeaux/1er--perets`);
    const same = node(data, 'custom/genealogie/fils-de-juda--perets');
    const phares = node(data, 'custom/genealogie/autre-nom--phares');
    expect(same.characterId).toBe(original.characterId);
    expect(phares.characterId).toBe(original.characterId);
    expect(data.characters.find((c) => c.id === original.characterId)?.aliases).toEqual(['PHARES']);
    expect(same.metadata.same_as).toBe(`${A}/les-jumeaux/1er--perets`);
    expect(same.id).not.toBe(original.id);
  });

  it('sibling key collisions get ~2; explicit duplicate keys are errors; empty categories are reported', () => {
    const page = parsePage(`@page 40\n@attach ${A}\nSAME\n  a • X\nSAME\n  b • Y\nOTHER {key: ${A}/same}\n  c • Z\nEMPTY\n`, 'p040.dsa');
    const { data, report } = buildGraphData('t', spine, [page], { allowUnsalted: true });
    expect(childKeys(data, A)).toEqual([`${A}/same`, `${A}/same~2`, `${A}/same~3`, `${A}/empty`]);
    expect(report.warnings.filter((w) => w.code !== 'EMPTY_CATEGORY').map((w) => w.message)).toEqual([`p040.dsa:5: key "${A}/same" already exists; using "${A}/same~2"`]);
    expect(report.errors.map((e) => e.message)).toEqual([`p040.dsa:7: {key: ${A}/same} is already used by another node; using "${A}/same~3"`]);
    expect(report.warnings.some((w) => w.code === 'EMPTY_CATEGORY' && w.message.startsWith('p040.dsa:9:'))).toBe(true);
    expect(new Set(data.nodes.map((n) => n.id)).size).toBe(data.nodes.length);
  });

  it('copies parse errors into the build report', () => {
    const { report } = buildGraphData('t', parseSpine('START DSA\n  nope\n', 's.dsa'), [], { allowUnsalted: true });
    expect(report.errors).toEqual([{ code: 'PARSE_ERROR', file: 's.dsa', line: 2, message: 's.dsa:2: expected "ANSWER -> TYPE LABEL"' }]);
  });
});
