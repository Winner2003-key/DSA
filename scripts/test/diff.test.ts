import { describe, expect, it } from 'vitest';
import { countChanges, deepEqual, mergeMetadata, planImport, projectSnapshot, summarize } from '../src/diff';
import type { PlanInput } from '../src/diff';
import { graphDataToRows } from '../src/rows';
import type { EdgeRow, NodeRow } from '../src/rows';
import { makeScope, selectScope } from '../src/select';
import { bookKeys, buildFixture, emptySnapshot, findCharacter, findNode, snapshotOf } from './fixtures';

const book = buildFixture();
const ALPHA = 'ancien[oui]/section-a/classe-un/le-premier--alpha';
const GAMMA = 'ancien[non]/section-b/sous-section/le-troisieme--gamma';

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  desired: graphDataToRows(book.data),
  book: bookKeys(book.data),
  existing: emptySnapshot(),
  ...over,
});

describe('deepEqual and mergeMetadata', () => {
  it('compares nested values and ignores key order', () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: '1' })).toBe(false);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
  });

  it('replaces the book keys and keeps the admin ones', () => {
    const merged = mergeMetadata(
      { printed_page: 1, notes: ['old'], origin: 'admin', layout: { x: 1 } },
      { printed_page: 2 },
      ['printed_page', 'notes'],
    );
    expect(merged).toEqual({ printed_page: 2, origin: 'admin', layout: { x: 1 } });
  });
});

describe('planImport on an empty database', () => {
  const plan = planImport(input());

  it('inserts everything once', () => {
    expect(plan.graph.action).toBe('INSERT');
    expect(countChanges(plan.nodes)).toMatchObject({ total: 9, inserted: 9, updated: 0, unchanged: 0 });
    expect(countChanges(plan.edges).inserted).toBe(plan.edges.length);
    expect(countChanges(plan.characters)).toMatchObject({ total: 3, inserted: 3 });
    expect(plan.prune.nodes).toEqual([]);
    expect(plan.admin.nodes).toEqual([]);
    expect(summarize(plan).hasChanges).toBe(true);
  });

  it('keeps the review status the book asked for', () => {
    expect(findNode(plan.nodes.map((c) => c.row), ALPHA).review_status).toBe('NEEDS_REVIEW');
    const gamma = findNode(plan.nodes.map((c) => c.row), GAMMA);
    expect(gamma.review_status).toBe('NEEDS_REVIEW');
    expect(gamma.review_note).toBe('à vérifier');
  });
});

describe('planImport against a database that already matches', () => {
  it('reports everything as unchanged', () => {
    const plan = planImport(input({ existing: snapshotOf(book.data) }));
    expect(plan.graph.action).toBe('UNCHANGED');
    expect(countChanges(plan.nodes)).toMatchObject({ inserted: 0, updated: 0, unchanged: 9 });
    expect(countChanges(plan.edges).unchanged).toBe(plan.edges.length);
    expect(countChanges(plan.characters).unchanged).toBe(3);
    expect(summarize(plan).hasChanges).toBe(false);
  });

  it('updates only what the transcription changed', () => {
    const edited = buildFixture({ page1: `@page 1\n@printed 1\n@attach ancien[oui]/section-a\n\nCLASSE UN {classe}\n  Le tout premier • ALPHA\n  Le second • BETA\n` });
    const plan = planImport({ desired: graphDataToRows(edited.data), book: bookKeys(edited.data), existing: snapshotOf(book.data) });
    const changed = plan.nodes.filter((c) => c.action !== 'UNCHANGED');
    // The clue is part of a CHARACTER's key, so editing it creates a new node and leaves the old one behind.
    expect(changed.map((c) => c.action)).toEqual(['INSERT']);
    expect(changed[0]?.key).toBe('ancien[oui]/section-a/classe-un/le-tout-premier--alpha');
    expect(plan.prune.nodes.map((n) => n.node_key)).toEqual([ALPHA]);
  });

  it('updates a row when a label changes without changing its key', () => {
    const edited = buildFixture({ page2: `@page 2\n@attach ancien[non]/section-b\n\nSOUS SECTION RENOMMEE {key: ancien[non]/section-b/sous-section}\n  Le troisième • GAMMA {review: à vérifier}\n` });
    const plan = planImport({ desired: graphDataToRows(edited.data), book: bookKeys(edited.data), existing: snapshotOf(book.data) });
    const change = plan.nodes.find((c) => c.key === 'ancien[non]/section-b/sous-section');
    expect(change?.action).toBe('UPDATE');
    expect(change?.changed).toEqual(['label']);
    expect(plan.prune.nodes).toEqual([]);
  });
});

describe('admin work is never overwritten', () => {
  const existing = snapshotOf(book.data);
  const alpha = findNode(existing.nodes, ALPHA);
  alpha.review_status = 'APPROVED';
  alpha.review_note = 'vérifié par le propriétaire';
  alpha.position_x = 120;
  alpha.position_y = -40;
  alpha.description = 'Description retouchée';
  alpha.metadata = { ...alpha.metadata, description_edited: true, layout: { pinned: true } };
  const character = findCharacter(existing.characters, 'ALPHA');
  character.gender = 'M';
  character.testament = 'ANCIEN';
  character.description = 'Fiche retouchée';
  character.metadata = { ...character.metadata, description_edited: true };
  const plan = planImport(input({ existing }));
  const change = plan.nodes.find((c) => c.key === ALPHA);

  it('keeps the review status, the note, the editor position and an edited description', () => {
    expect(change?.action).toBe('UNCHANGED');
    expect(change?.row).toMatchObject({
      review_status: 'APPROVED',
      review_note: 'vérifié par le propriétaire',
      position_x: 120,
      position_y: -40,
      description: 'Description retouchée',
    });
    expect(change?.row.metadata).toMatchObject({ description_edited: true, layout: { pinned: true }, printed_page: 1 });
    expect(change?.preserved).toContain('description');
    expect(change?.preserved).toContain('review_status');
    expect(change?.preserved).toContain('position_x/position_y');
    expect(change?.preserved).toContain('metadata.layout');
  });

  it('keeps admin-only character fields', () => {
    const c = plan.characters.find((x) => x.row.name === 'ALPHA');
    expect(c?.action).toBe('UNCHANGED');
    expect(c?.row).toMatchObject({ gender: 'M', testament: 'ANCIEN', description: 'Fiche retouchée' });
  });

  it('never touches or prunes rows an admin created', () => {
    const withAdmin = snapshotOf(book.data);
    const graphId = withAdmin.graph?.id as string;
    const adminNode: NodeRow = {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      graph_id: graphId,
      node_key: null,
      node_type: 'CATEGORY',
      label: 'AJOUT ADMIN',
      question: null,
      description: null,
      character_id: null,
      source_page: 1,
      position_x: null,
      position_y: null,
      review_status: 'APPROVED',
      review_note: null,
      metadata: { origin: 'admin' },
    };
    withAdmin.nodes.push(adminNode);
    const plan2 = planImport(input({ existing: withAdmin }));
    expect(plan2.admin.nodes.map((n) => n.label)).toEqual(['AJOUT ADMIN']);
    expect(plan2.prune.nodes).toEqual([]);
    expect(plan2.nodes.some((c) => c.id === adminNode.id)).toBe(false);
  });
});

describe('--approve', () => {
  it('approves every row of the selection and reports the ones tagged {review}', () => {
    const plan = planImport(input({ options: { approve: true } }));
    expect(new Set(plan.nodes.map((c) => c.row.review_status))).toEqual(new Set(['APPROVED']));
    expect(new Set(plan.edges.map((c) => c.row.review_status))).toEqual(new Set(['APPROVED']));
    expect(plan.approvedWithReviewNote).toContain(GAMMA);
  });

  it('is the only thing that changes a review status set in the database', () => {
    const existing = snapshotOf(book.data);
    findNode(existing.nodes, ALPHA).review_status = 'REJECTED';
    expect(planImport(input({ existing })).nodes.find((c) => c.key === ALPHA)?.row.review_status).toBe('REJECTED');
    expect(planImport(input({ existing, options: { approve: true } })).nodes.find((c) => c.key === ALPHA)?.row.review_status).toBe('APPROVED');
  });
});

describe('prune candidates', () => {
  const existing = snapshotOf(book.data);
  const ghost: NodeRow = { ...findNode(existing.nodes, GAMMA), id: 'bbbbbbbb-0000-4000-8000-000000000002', node_key: 'ancien[non]/section-b/sous-section/disparu--delta', label: 'DELTA', source_page: 2 };
  existing.nodes.push(ghost);

  it('lists book rows that no longer exist in the transcription', () => {
    const plan = planImport(input({ existing }));
    expect(plan.prune.nodes.map((n) => n.node_key)).toEqual([ghost.node_key]);
    expect(summarize(plan).hasChanges).toBe(false);
    expect(summarize(plan, true).hasChanges).toBe(true);
  });

  it('only considers the selected pages', () => {
    const scope = makeScope(book.data, [1]);
    const selected = selectScope(book.data, scope);
    const plan = planImport({ desired: graphDataToRows(selected), book: bookKeys(book.data), existing, options: { pages: [1] } });
    expect(plan.prune.nodes).toEqual([]);
    expect(planImport({ desired: graphDataToRows(selected), book: bookKeys(book.data), existing, options: { pages: [1, 2] } }).prune.nodes.map((n) => n.node_key)).toEqual([ghost.node_key]);
  });
});

describe('projectSnapshot', () => {
  it('describes the database as it will be, and drops the edges of pruned nodes', () => {
    const existing = snapshotOf(book.data);
    const ghost: NodeRow = { ...findNode(existing.nodes, GAMMA), id: 'cccccccc-0000-4000-8000-000000000003', node_key: 'ancien[non]/section-b/sous-section/disparu--delta', source_page: 2 };
    existing.nodes.push(ghost);
    existing.edges.push({ ...(existing.edges[0] as EdgeRow), id: 'dddddddd-0000-4000-8000-000000000004', from_node_id: findNode(existing.nodes, 'ancien[non]/section-b/sous-section').id, to_node_id: ghost.id, source_page: 2 });
    const plan = planImport(input({ existing }));
    const kept = projectSnapshot(existing, plan, false);
    expect(kept.nodes.some((n) => n.id === ghost.id)).toBe(true);
    const pruned = projectSnapshot(existing, plan, true);
    expect(pruned.nodes.some((n) => n.id === ghost.id)).toBe(false);
    expect(pruned.edges.some((e) => e.to_node_id === ghost.id)).toBe(false);
  });
});
