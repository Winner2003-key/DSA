import { answerClass, type AnswerClass, type NodeType } from '@dsa/core';

/**
 * Turns the traversed path into a drawing like the book's mind maps
 * (GRAPH_SPECIFICATION §8). Pure: no React, no measuring — text is wrapped from
 * an average glyph width, which is all a phone-sized diagram needs.
 *
 *   ANCIEN                       a spine question …
 *     │ OUI                      … goes down, labelled with its answer,
 *   HOMME                        … into the next question or the section it entered
 *     │ OUI
 *   PENTATEUQUE
 *     │ OUI
 *   ┏━━━━━━━━━━━━━━━━━━┓
 *   ┃ PENTATEUQUE (H.) ┃         an entered section is a box
 *   ┗━━━━━━━━━━━━━━━━━━┛
 *     │
 *   LIE A ADAM ─NON→ LIE A ABRAHAM      a NON moves right to the next item,
 *                      │ OUI            wrapping to a new line past maxColumns;
 *                    PÈRE DE LA FOI     an OUI on an item goes down into it
 *                      │ OUI
 *                    ★ ABRAM
 *
 * Only what was walked is drawn: no unused branch, no undone step (spec §6).
 */

/** The fields of `PathEntry` the layout reads. */
export interface LayoutStep {
  text: string;
  answer_label: string;
  prompt_kind: 'SPINE' | 'CHILD';
  node_type: NodeType;
  target_text: string | null;
}

export interface LayoutName {
  name: string;
  /** Already filtered by the homonym rule: null unless the name is shared. */
  description: string | null;
}

export type GraphNodeKind = 'QUESTION' | 'SECTION' | 'GROUP' | 'CLUE' | 'NAME';

export interface LayoutNode {
  id: string;
  kind: GraphNodeKind;
  text: string;
  lines: string[];
  /** NAME only. */
  descriptionLines: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  column: number;
  /** The path step this node is the prompt of; null for entered sections and the name. */
  stepIndex: number | null;
}

export interface Point {
  x: number;
  y: number;
}

export interface LayoutEdge {
  id: string;
  from: string;
  /** null for a stub: the last answer of a game still running, which leads nowhere yet. */
  to: string | null;
  points: Point[];
  /** Total polyline length, for the stroke-dashoffset drawing animation. */
  length: number;
  direction: 'down' | 'right' | 'wrap' | 'stub-down' | 'stub-right';
  /** The answer written on the edge; null for a section's first item or the name call. */
  answer: { label: string; cls: AnswerClass } | null;
  labelAt: Point | null;
  /** The final name was called rather than reached by an OUI. */
  dashed: boolean;
}

/** One animation step: what appears, and where the camera should look. */
export interface LayoutBeat {
  nodeIds: string[];
  edgeIds: string[];
  focus: { x: number; y: number; width: number; height: number };
}

export interface PathLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  beats: LayoutBeat[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  name?: LayoutName | null;
  /** Items per line before a run of NON wraps. 2 suits a phone, 3 a wider screen. */
  maxColumns?: number;
}

export const METRICS = {
  nodeWidth: 150,
  /** Horizontal room between items, wide enough for a NON tag. */
  gapX: 80,
  /** Vertical room between lines, tall enough for an answer tag. */
  gapY: 60,
  padX: 12,
  padY: 10,
  margin: 24,
  fontSize: 15,
  lineHeight: 20,
  nameFontSize: 22,
  nameLineHeight: 27,
  descriptionFontSize: 13,
  descriptionLineHeight: 17,
  /** Average glyph width of Zilla Slab semibold capitals, as a share of the font size. */
  glyph: 0.6,
} as const;

/** Greedy word wrap; a word longer than a line is cut. */
export function wrapText(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (let word of words) {
    while (word.length > maxChars) {
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= maxChars) line = `${line} ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

function charsPerLine(width: number, fontSize: number): number {
  return Math.max(4, Math.floor((width - 2 * METRICS.padX) / (fontSize * METRICS.glyph)));
}

function kindOf(step: LayoutStep): GraphNodeKind {
  if (step.prompt_kind === 'SPINE') return 'QUESTION';
  if (step.node_type === 'GROUP') return 'GROUP';
  if (step.node_type === 'CHARACTER') return 'CLUE';
  return 'SECTION';
}

function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

export function layoutPath(path: readonly LayoutStep[], options: LayoutOptions = {}): PathLayout {
  const maxColumns = Math.max(1, Math.floor(options.maxColumns ?? 3));
  const M = METRICS;
  const pitch = M.nodeWidth + M.gapX;

  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  const beats: LayoutBeat[] = [];

  /** The bottom of everything placed so far. */
  let bottom: number = M.margin;

  const place = (
    kind: GraphNodeKind,
    text: string,
    column: number,
    top: number,
    stepIndex: number | null,
    description: string | null = null,
  ): LayoutNode => {
    const isName = kind === 'NAME';
    const columnsWide = isName ? Math.min(2, maxColumns) : 1;
    const col = Math.max(0, Math.min(column, maxColumns - columnsWide));
    const width = columnsWide * M.nodeWidth + (columnsWide - 1) * M.gapX;
    const fontSize = isName ? M.nameFontSize : M.fontSize;
    const label = isName ? `★ ${text}` : text;
    const lines = wrapText(label, charsPerLine(width, fontSize));
    const descriptionLines = isName && description ? wrapText(description, charsPerLine(width, M.descriptionFontSize)) : [];
    const height =
      2 * M.padY +
      lines.length * (isName ? M.nameLineHeight : M.lineHeight) +
      (descriptionLines.length > 0 ? 4 + descriptionLines.length * M.descriptionLineHeight : 0);
    const node: LayoutNode = {
      id: `n${nodes.length}`,
      kind,
      text,
      lines,
      descriptionLines,
      x: M.margin + col * pitch,
      y: top,
      width,
      height,
      column: col,
      stepIndex,
    };
    nodes.push(node);
    bottom = Math.max(bottom, top + height);
    return node;
  };

  const connect = (
    from: LayoutNode,
    to: LayoutNode,
    direction: LayoutEdge['direction'],
    answerLabel: string | null,
    dashed = false,
  ): LayoutEdge => {
    let points: Point[];
    let labelAt: Point | null = null;
    if (direction === 'right') {
      const y = from.y + M.padY + M.lineHeight / 2;
      points = [
        { x: from.x + from.width, y },
        { x: to.x, y },
      ];
      labelAt = { x: (from.x + from.width + to.x) / 2, y };
    } else {
      const centre = from.x + from.width / 2;
      // A wide name box may sit one column to the left: keep the line inside it.
      const x = direction === 'down' ? Math.min(Math.max(centre, to.x + M.padX), to.x + to.width - M.padX) : centre;
      const start = { x, y: from.y + from.height };
      const end = { x: direction === 'down' ? x : to.x + to.width / 2, y: to.y };
      if (direction === 'down') {
        points = [start, end];
        labelAt = { x: start.x, y: (start.y + end.y) / 2 };
      } else {
        const midY = to.y - M.gapY / 2;
        points = [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
        labelAt = { x: (start.x + end.x) / 2, y: midY };
      }
    }
    const edge: LayoutEdge = {
      id: `e${edges.length}`,
      from: from.id,
      to: to.id,
      points,
      length: polylineLength(points),
      direction,
      answer: answerLabel === null ? null : { label: answerLabel, cls: answerClass(answerLabel) },
      labelAt: answerLabel === null ? null : labelAt,
      dashed,
    };
    edges.push(edge);
    return edge;
  };

  /** The answer of the last step when nothing has been asked after it yet. */
  const stub = (from: LayoutNode, answerLabel: string, right: boolean): LayoutEdge => {
    const points = right
      ? [
          { x: from.x + from.width, y: from.y + M.padY + M.lineHeight / 2 },
          { x: from.x + from.width + M.gapX, y: from.y + M.padY + M.lineHeight / 2 },
        ]
      : [
          { x: from.x + from.width / 2, y: from.y + from.height },
          { x: from.x + from.width / 2, y: from.y + from.height + M.gapY },
        ];
    const [a, b] = points as [Point, Point];
    const edge: LayoutEdge = {
      id: `e${edges.length}`,
      from: from.id,
      to: null,
      points,
      length: polylineLength(points),
      direction: right ? 'stub-right' : 'stub-down',
      answer: { label: answerLabel, cls: answerClass(answerLabel) },
      labelAt: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      dashed: false,
    };
    edges.push(edge);
    stubReach.x = Math.max(stubReach.x, b.x);
    stubReach.y = Math.max(stubReach.y, b.y);
    return edge;
  };
  const stubReach = { x: 0, y: 0 };

  const beat = (newNodes: LayoutNode[], newEdges: LayoutEdge[], context: LayoutNode | null) => {
    const shown = context ? [context, ...newNodes] : newNodes;
    const ends = newEdges.flatMap((e) => (e.to === null ? e.points : []));
    const minX = Math.min(...shown.map((n) => n.x));
    const minY = Math.min(...shown.map((n) => n.y));
    const maxX = Math.max(...shown.map((n) => n.x + n.width), ...ends.map((p) => p.x));
    const maxY = Math.max(...shown.map((n) => n.y + n.height), ...ends.map((p) => p.y));
    beats.push({
      nodeIds: newNodes.map((n) => n.id),
      edgeIds: newEdges.map((e) => e.id),
      focus: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    });
  };

  /** The top of a new line under everything drawn so far. */
  const nextLine = () => bottom + M.gapY;

  if (path.length === 0 && !options.name) {
    return { nodes, edges, beats, width: 2 * M.margin + M.nodeWidth, height: 2 * M.margin };
  }

  let current: LayoutNode | null = null;
  const first = path[0];
  if (first) {
    current = place(kindOf(first), first.text, 0, M.margin, 0);
    beat([current], [], null);
  }

  for (let i = 0; i < path.length; i++) {
    const step = path[i] as LayoutStep;
    const next = path[i + 1];
    const from = current as LayoutNode;
    const cls = answerClass(step.answer_label);
    const added: LayoutNode[] = [];
    const drawn: LayoutEdge[] = [];

    if (step.prompt_kind === 'SPINE') {
      // Down, labelled with the code, into the next question or the entered section.
      if (next && next.prompt_kind === 'SPINE') {
        const node = place('QUESTION', next.text, from.column, nextLine(), i + 1);
        drawn.push(connect(from, node, 'down', step.answer_label));
        added.push(node);
        current = node;
      } else {
        let parent = from;
        let label: string | null = step.answer_label;
        if (step.target_text) {
          const section = place('SECTION', step.target_text, from.column, nextLine(), null);
          drawn.push(connect(from, section, 'down', label));
          added.push(section);
          parent = section;
          label = null;
        }
        if (next) {
          const node = place(kindOf(next), next.text, parent.column, nextLine(), i + 1);
          drawn.push(connect(parent, node, 'down', label));
          added.push(node);
          current = node;
        } else {
          current = parent;
          if (!options.name && !step.target_text) drawn.push(stub(from, step.answer_label, false));
        }
      }
    } else if (cls === 'NON') {
      // Next item of the same list: to the right, or wrapped onto a new line.
      if (next) {
        const column = from.column + 1;
        const wraps = column >= maxColumns;
        const node = place(kindOf(next), next.text, wraps ? 0 : column, wraps ? nextLine() : from.y, i + 1);
        drawn.push(connect(from, node, wraps ? 'wrap' : 'right', step.answer_label));
        added.push(node);
        current = node;
      } else if (!options.name) {
        drawn.push(stub(from, step.answer_label, from.column + 1 < maxColumns));
      }
    } else if (next) {
      // OUI on an item: down into it, where its own list starts.
      const node = place(kindOf(next), next.text, from.column, nextLine(), i + 1);
      drawn.push(connect(from, node, 'down', step.answer_label));
      added.push(node);
      current = node;
    } else if (!options.name) {
      drawn.push(stub(from, step.answer_label, false));
    }

    if (!next && options.name) {
      const reachedByOui = step.prompt_kind === 'CHILD' && step.node_type === 'CHARACTER' && cls === 'OUI';
      const anchor = current as LayoutNode;
      const name = place('NAME', options.name.name, anchor.column, nextLine(), null, options.name.description);
      drawn.push(connect(anchor, name, 'down', reachedByOui ? step.answer_label : null, !reachedByOui));
      added.push(name);
      current = name;
    }

    if (added.length > 0 || drawn.length > 0) beat(added, drawn, from);
  }

  if (path.length === 0 && options.name) {
    const name = place('NAME', options.name.name, 0, M.margin, null, options.name.description);
    beat([name], [], null);
  }

  const width = Math.max(stubReach.x, ...nodes.map((n) => n.x + n.width)) + M.margin;
  const height = Math.max(bottom, stubReach.y) + M.margin;
  return { nodes, edges, beats, width, height };
}

/** Zoom and offset that fit a rectangle into a viewport, capped so text never balloons. */
export function fitRect(
  rect: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  options: { padding?: number; maxScale?: number; minScale?: number } = {},
): { scale: number; x: number; y: number } {
  const padding = options.padding ?? 16;
  const w = Math.max(1, viewport.width - 2 * padding);
  const h = Math.max(1, viewport.height - 2 * padding);
  const raw = Math.min(w / Math.max(1, rect.width), h / Math.max(1, rect.height));
  const scale = Math.min(options.maxScale ?? 1.4, Math.max(options.minScale ?? 0.2, raw));
  // Translation that puts the rect's centre at the viewport's centre (transform: translate, then scale about origin).
  const x = viewport.width / 2 - (rect.x + rect.width / 2) * scale;
  const y = viewport.height / 2 - (rect.y + rect.height / 2) * scale;
  return { scale, x, y };
}
