// Parser and graph builder for the book transcription format (GRAPH_SPECIFICATION.md §5).

import { assertIdSalt, characterId, characterKey, collisionKey, edgeId, graphId, nodeId, spineChildKey, treeChildKey } from './keys';
import type { IdOptions } from './keys';
import { normalizeName } from './normalize';
import type {
  BibleCharacter,
  BuildIssue,
  BuildOptions,
  BuildReport,
  GraphData,
  GraphEdge,
  GraphNode,
  GroupKind,
  NodeMetadata,
  NodeType,
  ParsedAttach,
  ParsedPage,
  ParsedSpine,
  ParsedSpineNode,
  ParsedTag,
  ParsedTreeItem,
  ParseError,
  ReviewStatus,
  SourceVariant,
} from './types';

// ---------------------------------------------------------------------------
// Line-level helpers

const SPINE_TYPES = new Set<NodeType>(['QUESTION', 'CATEGORY', 'GROUP', 'CHARACTER', 'REFERENCE', 'END']);
const GROUP_TAGS: Record<string, GroupKind> = { classe: 'CLASSE', tome: 'TOME', alias: 'ALIAS' };
const KNOWN_TAGS = new Set(['classe', 'tome', 'alias', 'group', 'review', 'note', 'variant', 'variants', 'key', 'same-as']);
const VALUE_TAGS = new Set(['note', 'variant', 'variants', 'key', 'same-as']);
const FLAG_TAGS = new Set(['classe', 'tome', 'alias']);
/** Character separator: `•`, `·`, or ` * ` (asterisk surrounded by spaces). */
const SEPARATOR = /\s*[•·]\s*|\s+\*\s+/g;

interface SourceLine {
  line: number;
  depth: number;
  text: string;
}

/** Replaces the inside of `{…}` tags with underscores so structural characters are only found outside tags. */
function maskTags(s: string): string {
  let depth = 0;
  let out = '';
  for (const ch of s) {
    if (ch === '{') {
      depth++;
      out += ch;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
      out += ch;
    } else out += depth > 0 ? '_'.repeat(ch.length) : ch;
  }
  return out;
}

function readLines(text: string, file: string, errors: ParseError[]): SourceLine[] {
  const lines: SourceLine[] = [];
  text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = i + 1;
      const masked = maskTags(raw);
      let cut = -1;
      for (let j = 0; j < masked.length; j++) {
        if (masked[j] === '#' && (j === 0 || /\s/.test(masked[j - 1] as string))) {
          cut = j;
          break;
        }
      }
      const content = (cut >= 0 ? raw.slice(0, cut) : raw).replace(/\s+$/, '');
      if (content.trim() === '') return;
      const indent = /^[ \t]*/.exec(content)?.[0] ?? '';
      if (indent.includes('\t')) {
        errors.push({ file, line, message: `${file}:${line}: tab in indentation (use 2 spaces)` });
        return;
      }
      if (indent.length % 2 !== 0) {
        errors.push({ file, line, message: `${file}:${line}: odd indentation (${indent.length} spaces; use multiples of 2)` });
        return;
      }
      lines.push({ line, depth: indent.length / 2, text: content.trim() });
    });
  return lines;
}

interface Extracted {
  text: string;
  tags: ParsedTag[];
  pages: number[];
}

function extract(segment: string, file: string, line: number, errors: ParseError[], allowPages: boolean): Extracted {
  const tags: ParsedTag[] = [];
  let text = segment.replace(/\{([^{}]*)\}/g, (_m, inner: string) => {
    const colon = inner.indexOf(':');
    if (colon >= 0) tags.push({ name: inner.slice(0, colon).trim().toLowerCase(), value: inner.slice(colon + 1).trim() });
    else tags.push({ name: inner.trim().toLowerCase(), value: null });
    return ' ';
  });
  if (/[{}]/.test(text)) errors.push({ file, line, message: `${file}:${line}: unbalanced "{" or "}"` });
  const pages: number[] = [];
  text = text.replace(/(^|\s)@p(\d+)(?=\s|$)/g, (_m, pre: string, n: string) => {
    pages.push(Number(n));
    return pre;
  });
  if (pages.length > 0 && !allowPages) errors.push({ file, line, message: `${file}:${line}: @pNN is not allowed here` });
  if (text.includes('@')) errors.push({ file, line, message: `${file}:${line}: unexpected "@" (page lists are written @p12 @p13)` });
  for (const tag of tags) {
    if (!KNOWN_TAGS.has(tag.name)) errors.push({ file, line, message: `${file}:${line}: unknown tag {${tag.name}}` });
    else if (VALUE_TAGS.has(tag.name) && (tag.value === null || tag.value === '')) errors.push({ file, line, message: `${file}:${line}: tag {${tag.name}} needs a value` });
    else if (FLAG_TAGS.has(tag.name) && tag.value !== null) errors.push({ file, line, message: `${file}:${line}: tag {${tag.name}} takes no value` });
    else if (tag.name === 'group' && tag.value !== null && !['CLASSE', 'TOME', 'ALIAS', 'OTHER'].includes(tag.value.toUpperCase())) {
      errors.push({ file, line, message: `${file}:${line}: {group: ${tag.value}} must be CLASSE, TOME, ALIAS or OTHER` });
    }
  }
  return { text: text.replace(/\s+/g, ' ').trim(), tags, pages };
}

function groupKindOf(tags: ParsedTag[], file: string, line: number, errors: ParseError[]): GroupKind | null {
  const kinds: GroupKind[] = [];
  for (const t of tags) {
    const k = GROUP_TAGS[t.name];
    if (k) kinds.push(k);
    if (t.name === 'group') kinds.push((t.value?.toUpperCase() as GroupKind | undefined) ?? 'OTHER');
  }
  if (kinds.length > 1) errors.push({ file, line, message: `${file}:${line}: several group kinds (${kinds.join(', ')})` });
  return kinds[0] ?? null;
}

// ---------------------------------------------------------------------------
// parseSpine

export function parseSpine(text: string, fileName: string): ParsedSpine {
  const errors: ParseError[] = [];
  let root: ParsedSpineNode | null = null;
  const stack: ParsedSpineNode[] = [];
  const fail = (line: number, message: string) => errors.push({ file: fileName, line, message: `${fileName}:${line}: ${message}` });
  const placeholder = (line: number): ParsedSpineNode => ({ line, answerLabel: null, edgeTags: [], nodeType: 'END', label: '', nodeTags: [], pages: [], children: [] });

  for (const src of readLines(text, fileName, errors)) {
    if (root === null) {
      const e = extract(src.text, fileName, src.line, errors, true);
      const m = /^START\s+(.+)$/.exec(e.text);
      if (src.depth !== 0 || !m) {
        fail(src.line, 'the spine must start with "START <label>" at column 0');
        root = placeholder(src.line);
        root.nodeType = 'START';
        stack.length = 0;
        stack.push(root);
        continue;
      }
      root = { line: src.line, answerLabel: null, edgeTags: [], nodeType: 'START', label: (m[1] as string).trim(), nodeTags: e.tags, pages: e.pages, children: [] };
      stack.push(root);
      continue;
    }
    if (src.depth === 0) {
      fail(src.line, 'only one START line is allowed at column 0');
      continue;
    }
    if (src.depth > stack.length) {
      fail(src.line, `indentation jumps from level ${stack.length - 1} to ${src.depth}`);
      continue;
    }
    stack.length = src.depth;
    const parent = stack[src.depth - 1] as ParsedSpineNode;
    const node = parseSpineEdgeLine(src, fileName, errors) ?? placeholder(src.line);
    if (node.label !== '') {
      if (parent.nodeType === 'CHARACTER') fail(src.line, 'a CHARACTER cannot have children');
      else if (parent.label !== '' || parent === root) parent.children.push(node);
    }
    stack.push(node);
  }
  if (root === null) errors.push({ file: fileName, line: 1, message: `${fileName}:1: empty spine (expected "START <label>")` });
  return { fileName, root: root && root.label !== '' ? root : null, errors };
}

function parseSpineEdgeLine(src: SourceLine, file: string, errors: ParseError[]): ParsedSpineNode | null {
  const before = errors.length;
  const arrow = maskTags(src.text).indexOf('->');
  if (arrow < 0) {
    errors.push({ file, line: src.line, message: `${file}:${src.line}: expected "ANSWER -> TYPE LABEL"` });
    return null;
  }
  const left = extract(src.text.slice(0, arrow), file, src.line, errors, false);
  const right = extract(src.text.slice(arrow + 2), file, src.line, errors, true);
  const m = /^(\S+)\s+(.+)$/.exec(right.text);
  const type = m?.[1]?.toUpperCase() as NodeType | undefined;
  if (left.text === '') errors.push({ file, line: src.line, message: `${file}:${src.line}: missing answer label before "->"` });
  if (!m || type === undefined || !SPINE_TYPES.has(type)) {
    errors.push({ file, line: src.line, message: `${file}:${src.line}: expected "TYPE LABEL" after "->" with TYPE in ${[...SPINE_TYPES].join('|')}` });
  }
  if (errors.length > before || !m || type === undefined) return null;
  return {
    line: src.line,
    answerLabel: left.text,
    edgeTags: left.tags,
    nodeType: type,
    label: (m[2] as string).trim(),
    nodeTags: right.tags,
    pages: right.pages,
    children: [],
  };
}

// ---------------------------------------------------------------------------
// parsePage

export function parsePage(text: string, fileName: string): ParsedPage {
  const errors: ParseError[] = [];
  const fail = (line: number, message: string) => errors.push({ file: fileName, line, message: `${fileName}:${line}: ${message}` });
  const result: ParsedPage = { fileName, page: null, printed: null, attaches: [], errors };
  let attach: ParsedAttach | null = null;
  // stack[d] = item at depth d; null marks a broken line whose children are skipped.
  const stack: (ParsedTreeItem | null)[] = [];

  for (const src of readLines(text, fileName, errors)) {
    if (src.text.startsWith('@') && !/^@p\d+(\s|$)/.test(src.text)) {
      if (src.depth !== 0) fail(src.line, 'directives must start at column 0');
      const m = /^@(\w+)(?:\s+(.*))?$/.exec(src.text);
      const name = m?.[1] ?? '';
      const value = (m?.[2] ?? '').trim();
      if (name === 'page' || name === 'printed') {
        if (!/^\d+$/.test(value)) fail(src.line, `@${name} needs a page number`);
        else if (name === 'page') {
          if (result.page !== null) fail(src.line, 'duplicate @page');
          result.page = Number(value);
        } else result.printed = Number(value);
      } else if (name === 'attach') {
        if (!/^\S+$/.test(value)) fail(src.line, '@attach needs one node key (no spaces)');
        attach = { key: value, line: src.line, items: [] };
        result.attaches.push(attach);
        stack.length = 0;
      } else fail(src.line, `unknown directive @${name}`);
      continue;
    }

    if (src.depth > stack.length) {
      fail(src.line, `indentation jumps from level ${stack.length - 1} to ${src.depth}`);
      continue;
    }
    stack.length = src.depth;
    const item = parseTreeLine(src, fileName, errors);
    if (src.depth === 0) {
      if (attach === null) {
        fail(src.line, 'item before any @attach');
        stack.push(null);
        continue;
      }
      if (item) attach.items.push(item);
    } else {
      const parent = stack[src.depth - 1];
      if (parent === null || parent === undefined) {
        stack.push(null);
        continue;
      }
      if (parent.kind === 'CHARACTER') {
        fail(src.line, `a CHARACTER (${parent.label}, line ${parent.line}) cannot have children`);
        stack.push(null);
        continue;
      }
      if (item) parent.children.push(item);
    }
    stack.push(item);
  }
  if (result.page === null) errors.push({ file: fileName, line: 1, message: `${fileName}:1: missing @page` });
  if (result.attaches.length === 0) errors.push({ file: fileName, line: 1, message: `${fileName}:1: missing @attach` });
  return result;
}

function parseTreeLine(src: SourceLine, file: string, errors: ParseError[]): ParsedTreeItem | null {
  const before = errors.length;
  const masked = maskTags(src.text);
  const separators = [...masked.matchAll(SEPARATOR)];
  let item: ParsedTreeItem;
  if (separators.length > 1) {
    errors.push({ file, line: src.line, message: `${file}:${src.line}: several "•" separators on one line` });
    return null;
  }
  const sep = separators[0];
  if (sep && sep.index !== undefined) {
    const left = extract(src.text.slice(0, sep.index), file, src.line, errors, true);
    const right = extract(src.text.slice(sep.index + sep[0].length), file, src.line, errors, true);
    const tags = [...left.tags, ...right.tags];
    if (right.text === '') errors.push({ file, line: src.line, message: `${file}:${src.line}: missing NAME after "•"` });
    if (groupKindOf(tags, file, src.line, errors) !== null) errors.push({ file, line: src.line, message: `${file}:${src.line}: a CHARACTER cannot be a group ({classe}/{tome}/{alias}/{group})` });
    item = { line: src.line, kind: 'CHARACTER', label: right.text, clue: left.text === '' ? null : left.text, groupKind: null, tags, pages: [...left.pages, ...right.pages], children: [] };
  } else {
    const e = extract(src.text, file, src.line, errors, true);
    if (e.text === '') errors.push({ file, line: src.line, message: `${file}:${src.line}: empty label` });
    if (e.tags.some((t) => t.name === 'same-as')) errors.push({ file, line: src.line, message: `${file}:${src.line}: {same-as} is only allowed on a CHARACTER line (clue • NAME)` });
    item = { line: src.line, kind: 'CATEGORY', label: e.text, clue: null, groupKind: groupKindOf(e.tags, file, src.line, errors), tags: e.tags, pages: e.pages, children: [] };
  }
  return errors.length > before ? null : item;
}

// ---------------------------------------------------------------------------
// buildGraphData

interface BuiltNode {
  node: GraphNode;
  parentKey: string | null;
  groupKind: GroupKind | null;
  sameAs: string | null;
  file: string;
  line: number;
  nextOrder: number;
  firstChildKey: string | null;
}

interface Entry {
  file: string;
  page: number | null;
  printed: number | null;
  item: ParsedTreeItem;
}

const tagValues = (tags: ParsedTag[], name: string): string[] =>
  tags.filter((t) => t.name === name && t.value !== null).map((t) => t.value as string);

export function buildGraphData(
  graphSlug: string,
  spine: ParsedSpine,
  pages: ParsedPage[],
  opts: BuildOptions = {},
): { data: GraphData; report: BuildReport } {
  const defaultStatus: ReviewStatus = opts.defaultReviewStatus ?? 'NEEDS_REVIEW';
  const ids: IdOptions = { salt: opts.idSalt ?? null, allowUnsalted: opts.allowUnsalted === true };
  assertIdSalt(graphSlug, ids);
  const gid = graphId(graphSlug);
  const errors: BuildIssue[] = [];
  const warnings: BuildIssue[] = [];
  const issue = (list: BuildIssue[], code: BuildIssue['code'], file: string | null, line: number | null, message: string) =>
    list.push({ code, file, line, message: file !== null && line !== null ? `${file}:${line}: ${message}` : message });

  for (const e of [...spine.errors, ...pages.flatMap((p) => p.errors)]) errors.push({ code: 'PARSE_ERROR', file: e.file, line: e.line, message: e.message });

  const built = new Map<string, BuiltNode>();
  const order: BuiltNode[] = [];
  const edges: GraphEdge[] = [];

  // @attach key → entries and declarations.
  const attachEntries = new Map<string, Entry[]>();
  const attachDecls = new Map<string, { file: string; line: number }[]>();
  const sortedPages = [...pages].sort((a, b) => (a.page ?? Number.MAX_SAFE_INTEGER) - (b.page ?? Number.MAX_SAFE_INTEGER));
  for (const p of sortedPages) {
    for (const a of p.attaches) {
      if (a.key === '') continue;
      const entries = attachEntries.get(a.key) ?? [];
      for (const item of a.items) entries.push({ file: p.fileName, page: p.page, printed: p.printed, item });
      attachEntries.set(a.key, entries);
      const decls = attachDecls.get(a.key) ?? [];
      decls.push({ file: p.fileName, line: a.line });
      attachDecls.set(a.key, decls);
    }
  }
  const takeAttached = (key: string): Entry[] => {
    const entries = attachEntries.get(key) ?? [];
    attachEntries.delete(key);
    attachDecls.delete(key);
    return entries;
  };
  const byPageThenLine = (a: Entry, b: Entry) =>
    (a.page ?? Number.MAX_SAFE_INTEGER) - (b.page ?? Number.MAX_SAFE_INTEGER) || a.item.line - b.item.line;

  const claimKey = (base: string, explicit: boolean, file: string, line: number): string => {
    if (!built.has(base)) return base;
    let n = 2;
    while (built.has(collisionKey(base, n))) n++;
    const key = collisionKey(base, n);
    if (explicit) issue(errors, 'DUPLICATE_KEY', file, line, `{key: ${base}} is already used by another node; using "${key}"`);
    else issue(warnings, 'KEY_COLLISION', file, line, `key "${base}" already exists; using "${key}"`);
    return key;
  };

  const review = (tags: ParsedTag[]): { status: ReviewStatus; note: string | null } => {
    const reviews = tags.filter((t) => t.name === 'review');
    if (reviews.length === 0) return { status: defaultStatus, note: null };
    const notes = reviews.map((t) => t.value).filter((v): v is string => v !== null && v !== '');
    return { status: 'NEEDS_REVIEW', note: notes.length > 0 ? notes.join('; ') : null };
  };

  const register = (b: BuiltNode, parent: BuiltNode | null) => {
    built.set(b.node.nodeKey, b);
    order.push(b);
    if (parent && parent.firstChildKey === null) parent.firstChildKey = b.node.nodeKey;
  };

  const addEdge = (
    parent: BuiltNode,
    child: BuiltNode,
    kind: GraphEdge['edgeKind'],
    label: string,
    sourcePage: number | null,
    status: { status: ReviewStatus; note: string | null },
    metadata: GraphEdge['metadata'],
  ) => {
    edges.push({
      id: edgeId(graphSlug, parent.node.nodeKey, child.node.nodeKey, ids),
      graphId: gid,
      fromNodeId: parent.node.id,
      toNodeId: child.node.id,
      answerLabel: label,
      edgeKind: kind,
      orderIndex: parent.nextOrder++,
      sourcePage,
      reviewStatus: status.status,
      reviewNote: status.note,
      metadata,
    });
  };

  const makeNode = (key: string, type: NodeType, label: string, question: string | null, status: { status: ReviewStatus; note: string | null }, sourcePage: number | null, metadata: NodeMetadata): GraphNode => ({
    id: nodeId(graphSlug, key, ids),
    graphId: gid,
    nodeKey: key,
    nodeType: type,
    label,
    question,
    description: null,
    characterId: null,
    sourcePage,
    positionX: null,
    positionY: null,
    reviewStatus: status.status,
    reviewNote: status.note,
    metadata,
  });

  const commonMetadata = (tags: ParsedTag[], groupKind: GroupKind | null, extraPages: number[]): NodeMetadata => {
    const md: NodeMetadata = {};
    if (extraPages.length > 0) md.extra_pages = extraPages;
    if (groupKind) md.group_kind = groupKind;
    const notes = tagValues(tags, 'note');
    if (notes.length > 0) md.notes = notes;
    const variants = [...tagValues(tags, 'variant'), ...tagValues(tags, 'variants').flatMap((v) => v.split(',').map((x) => x.trim()).filter(Boolean))];
    if (variants.length > 0) md.variants = variants;
    return md;
  };

  const expand = (parent: BuiltNode, entries: Entry[]) => {
    if (entries.length === 0) return;
    if (parent.node.nodeType !== 'CATEGORY' && parent.node.nodeType !== 'GROUP') {
      for (const e of entries) {
        issue(errors, 'INVALID_ATTACH_TARGET', e.file, e.item.line, `"${e.item.label}" cannot be a child of ${parent.node.nodeType} ${parent.node.nodeKey} (only CATEGORY and GROUP have ordered children)`);
      }
      return;
    }
    for (const e of [...entries].sort(byPageThenLine)) buildItem(e, parent);
  };

  const buildItem = (entry: Entry, parent: BuiltNode) => {
    const { item } = entry;
    const explicit = tagValues(item.tags, 'key')[0];
    const base = explicit ?? (item.kind === 'CHARACTER' ? characterKey(parent.node.nodeKey, item.clue, item.label) : treeChildKey(parent.node.nodeKey, item.label));
    const key = claimKey(base, explicit !== undefined, entry.file, item.line);
    const type: NodeType = item.kind === 'CHARACTER' ? 'CHARACTER' : item.groupKind ? 'GROUP' : 'CATEGORY';
    const status = review(item.tags);
    const md = commonMetadata(item.tags, item.groupKind, item.pages);
    if (entry.printed !== null) md.printed_page = entry.printed;
    if (type === 'CHARACTER' && parent.groupKind === 'ALIAS' && item.clue !== null) md.qualifier = item.clue;
    const sameAs = tagValues(item.tags, 'same-as')[0] ?? null;
    if (sameAs !== null) md.same_as = sameAs;
    const b: BuiltNode = {
      node: makeNode(key, type, item.label, type === 'CHARACTER' ? item.clue : null, status, entry.page, md),
      parentKey: parent.node.nodeKey,
      groupKind: item.groupKind,
      sameAs,
      file: entry.file,
      line: item.line,
      nextOrder: 0,
      firstChildKey: null,
    };
    register(b, parent);
    addEdge(parent, b, 'HIERARCHY', 'OUI', entry.page, status, {});
    if (type === 'CHARACTER') return;
    const nested = item.children.map((c): Entry => ({ ...entry, item: c }));
    expand(b, [...nested, ...takeAttached(key)]);
  };

  const buildSpine = (sn: ParsedSpineNode, parent: BuiltNode | null) => {
    const explicit = tagValues(sn.nodeTags, 'key')[0];
    const base =
      explicit ??
      (parent === null || parent.node.nodeType === 'START'
        ? spineChildKey(null, sn.answerLabel ?? '', sn.label)
        : spineChildKey(parent.node.nodeKey, sn.answerLabel ?? '', sn.label));
    const key = claimKey(base, explicit !== undefined, spine.fileName, sn.line);
    const groupKind = sn.nodeType === 'GROUP' ? groupKindOf(sn.nodeTags, spine.fileName, sn.line, []) ?? 'OTHER' : null;
    const status = review(sn.nodeTags);
    const b: BuiltNode = {
      node: makeNode(key, sn.nodeType, sn.label, null, status, sn.pages[0] ?? null, commonMetadata(sn.nodeTags, groupKind, sn.pages.slice(1))),
      parentKey: parent?.node.nodeKey ?? null,
      groupKind,
      sameAs: null,
      file: spine.fileName,
      line: sn.line,
      nextOrder: 0,
      firstChildKey: null,
    };
    register(b, parent);
    if (parent && sn.answerLabel !== null) {
      const md: GraphEdge['metadata'] = {};
      const variants = [...tagValues(sn.edgeTags, 'variants'), ...tagValues(sn.edgeTags, 'variant')]
        .flatMap((v) => v.split(','))
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v): SourceVariant => {
          const m = /^(.*?)\s*@\s*p?(\d+)$/.exec(v);
          return m ? { label: (m[1] as string).trim(), page: Number(m[2]) } : { label: v, page: sn.pages[0] ?? 0 };
        });
      if (variants.length > 0) md.source_variants = variants;
      const notes = tagValues(sn.edgeTags, 'note');
      if (notes.length > 0) md.notes = notes;
      const kind = parent.node.nodeType === 'START' ? 'SYSTEM' : 'DECISION';
      addEdge(parent, b, kind, sn.answerLabel, sn.pages[0] ?? null, review(sn.edgeTags), md);
    }
    for (const child of sn.children) buildSpine(child, b);
    expand(b, takeAttached(key));
  };

  if (spine.root) buildSpine(spine.root, null);

  for (const [key, decls] of attachDecls) {
    for (const d of decls) issue(errors, 'UNRESOLVED_ATTACH', d.file, d.line, `@attach ${key} does not match any node`);
  }

  // Characters ---------------------------------------------------------------
  const characters: BibleCharacter[] = [];
  const assigned = new Map<string, BibleCharacter>();
  const resolving = new Set<string>();

  const nearestCategory = (b: BuiltNode): string | null => {
    let key = b.parentKey;
    while (key !== null) {
      const p = built.get(key);
      if (!p) return null;
      if (p.node.nodeType === 'CATEGORY') return p.node.label;
      key = p.parentKey;
    }
    return null;
  };

  const createCharacter = (b: BuiltNode, clue: string | null): BibleCharacter => {
    const category = nearestCategory(b);
    const parts = [clue, category].filter((x): x is string => x !== null && x.trim() !== '');
    const metadata: Record<string, unknown> = { node_key: b.node.nodeKey };
    for (const k of ['printed_page', 'extra_pages', 'notes', 'variants'] as const) if (b.node.metadata[k] !== undefined) metadata[k] = b.node.metadata[k];
    if (b.node.sourcePage !== null) metadata.source_page = b.node.sourcePage;
    const c: BibleCharacter = {
      id: characterId(graphSlug, b.node.nodeKey, ids),
      name: b.node.label,
      nameFr: b.node.label,
      nameEn: null,
      gender: null,
      testament: null,
      description: parts.length > 0 ? parts.join(' · ') : null,
      aliases: [],
      isActive: true,
      metadata,
    };
    characters.push(c);
    return c;
  };

  const addAlias = (c: BibleCharacter, label: string) => {
    const n = normalizeName(label);
    if (n !== normalizeName(c.name) && !c.aliases.some((a) => normalizeName(a) === n)) c.aliases.push(label);
  };

  const resolveCharacter = (b: BuiltNode): BibleCharacter => {
    const done = assigned.get(b.node.nodeKey);
    if (done) return done;
    if (resolving.has(b.node.nodeKey)) {
      issue(errors, 'UNRESOLVED_SAME_AS', b.file, b.line, `{same-as} cycle through ${b.node.nodeKey}`);
      const own = createCharacter(b, b.node.question);
      assigned.set(b.node.nodeKey, own);
      return own;
    }
    resolving.add(b.node.nodeKey);
    let c: BibleCharacter;
    const parent = b.parentKey !== null ? built.get(b.parentKey) : undefined;
    if (b.sameAs !== null) {
      const target = built.get(b.sameAs);
      if (target && target.node.nodeType === 'CHARACTER' && target !== b) {
        c = resolveCharacter(target);
        addAlias(c, b.node.label);
      } else {
        issue(errors, 'UNRESOLVED_SAME_AS', b.file, b.line, `{same-as: ${b.sameAs}} does not match a CHARACTER node`);
        c = createCharacter(b, b.node.question);
      }
    } else if (parent && parent.groupKind === 'ALIAS') {
      const first = parent.firstChildKey !== null ? built.get(parent.firstChildKey) : undefined;
      if (first && first !== b && first.node.nodeType === 'CHARACTER') {
        c = resolveCharacter(first);
        addAlias(c, b.node.label);
      } else {
        c = createCharacter(b, parent.node.label);
      }
    } else {
      c = createCharacter(b, b.node.question);
    }
    resolving.delete(b.node.nodeKey);
    assigned.set(b.node.nodeKey, c);
    return c;
  };

  for (const b of order) {
    const type = b.node.nodeType;
    if (type === 'CHARACTER') {
      const c = resolveCharacter(b);
      b.node.characterId = c.id;
    }
    if (b.groupKind === 'ALIAS') {
      const nonCharacters = order.filter((x) => x.parentKey === b.node.nodeKey && x.node.nodeType !== 'CHARACTER');
      for (const x of nonCharacters) issue(errors, 'INVALID_ALIAS_GROUP', x.file, x.line, `alias group "${b.node.label}" may only contain CHARACTER lines (clue • NAME)`);
    }
    if ((type === 'CATEGORY' || type === 'GROUP') && b.nextOrder === 0) {
      issue(warnings, 'EMPTY_CATEGORY', b.file, b.line, `${type} "${b.node.label}" (${b.node.nodeKey}) has no children yet`);
    }
  }
  const descriptions = new Map(characters.map((c) => [c.id, c.description]));
  for (const b of order) if (b.node.characterId !== null) b.node.description = descriptions.get(b.node.characterId) ?? null;

  const data: GraphData = {
    graph: {
      id: gid,
      slug: graphSlug,
      name: opts.graphName ?? spine.root?.label ?? graphSlug,
      description: null,
      version: 1,
      isActive: true,
      status: opts.graphStatus ?? 'DRAFT',
      sourceDocument: opts.sourceDocument ?? null,
    },
    nodes: order.map((b) => b.node),
    edges,
    characters,
  };
  return {
    data,
    report: { errors, warnings, stats: { pages: pages.length, nodes: data.nodes.length, edges: edges.length, characters: characters.length } },
  };
}

export function formatBuildReport(report: BuildReport, opts: { maxIssues?: number } = {}): string {
  const max = opts.maxIssues ?? Number.POSITIVE_INFINITY;
  const lines = [`✓ ${report.stats.pages} pages → ${report.stats.nodes} nodes, ${report.stats.edges} edges, ${report.stats.characters} characters`];
  const counts = (issues: BuildIssue[]) => {
    const byCode = new Map<string, number>();
    for (const i of issues) byCode.set(i.code, (byCode.get(i.code) ?? 0) + 1);
    return [...byCode].map(([c, n]) => `${c} ${n}`).join(', ');
  };
  lines.push(`${report.errors.length === 0 ? '✓' : '✗'} ${report.errors.length} build errors${report.errors.length ? ` (${counts(report.errors)})` : ''}`);
  lines.push(`${report.warnings.length === 0 ? '✓' : '⚠'} ${report.warnings.length} build warnings${report.warnings.length ? ` (${counts(report.warnings)})` : ''}`);
  report.errors.slice(0, max).forEach((i) => lines.push(`ERROR: [${i.code}] ${i.message}`));
  report.warnings.slice(0, max).forEach((i) => lines.push(`WARNING: [${i.code}] ${i.message}`));
  return lines.join('\n');
}
