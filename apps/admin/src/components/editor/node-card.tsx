'use client';

import type { GraphNode, NodeType, ReviewStatus } from '@dsa/core';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { GROUP_KIND_LABEL } from '../../lib/labels';
import { NODE_HEIGHT, NODE_WIDTH } from '../../lib/layout';

export interface NodeCardData extends Record<string, unknown> {
  node: GraphNode;
  /** The answer that leads into this card, printed in its left gutter. */
  incomingLabel: string | null;
  childCount: number;
  /** Children hidden by the focus depth; the card offers to descend into them. */
  hiddenChildren: number;
  matched: boolean;
}

export type NodeCardType = Node<NodeCardData, 'dsa'>;

/**
 * The card is the one place this interface is allowed to be expressive: it is
 * what an admin compares with the printed page. The book's own words are set in
 * the serif, the tool's annotations in the grotesque, and the left gutter
 * carries both the answer that leads here and the review status.
 */
const SURFACE: Record<NodeType, string> = {
  START: 'bg-ink text-white',
  QUESTION: 'bg-surface',
  CATEGORY: 'bg-surface',
  GROUP: 'bg-surface',
  CHARACTER: 'bg-[#fbfcfd]',
  REFERENCE: 'bg-review-soft',
  END: 'bg-surface-sunk',
};

const BORDER: Record<ReviewStatus, string> = {
  DRAFT: 'border-dotted border-rule-strong',
  NEEDS_REVIEW: 'border-dashed border-review',
  APPROVED: 'border-solid border-rule-strong',
  REJECTED: 'border-solid border-rejected',
};

const GUTTER: Record<ReviewStatus, string> = {
  DRAFT: 'bg-draft',
  NEEDS_REVIEW: 'bg-review',
  APPROVED: 'bg-approved',
  REJECTED: 'bg-rejected',
};

export function NodeCard({ data, selected }: NodeProps<NodeCardType>) {
  const { node, incomingLabel, childCount, hiddenChildren, matched } = data;
  const isCharacter = node.nodeType === 'CHARACTER';
  const groupKind = node.metadata.group_kind;

  return (
    <div
      style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
      className={[
        'relative flex overflow-hidden rounded-md border-2 text-left',
        SURFACE[node.nodeType],
        BORDER[node.reviewStatus],
        selected ? 'ring-2 ring-accent ring-offset-1' : '',
        matched && !selected ? 'ring-2 ring-review/60' : '',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top} />

      <div className={`w-1.5 shrink-0 ${GUTTER[node.reviewStatus]}`} aria-hidden />

      <div className="min-w-0 flex-1 px-2.5 py-2">
        {incomingLabel && (
          <div className="mb-1 truncate text-[10px] font-semibold tracking-[0.03em] text-ink-faint">{incomingLabel}</div>
        )}

        {isCharacter ? (
          <>
            {node.question && <div className="book truncate text-[12px] italic text-ink-soft">{node.question}</div>}
            <div className="book truncate text-[16px] font-semibold leading-tight">{node.label}</div>
          </>
        ) : (
          <div className={`book text-[14px] font-medium leading-snug ${node.nodeType === 'START' ? 'text-white' : ''}`}>{node.label}</div>
        )}

        <div className={`mt-1.5 flex items-center gap-1.5 text-[10px] ${node.nodeType === 'START' ? 'text-white/70' : 'text-ink-faint'}`}>
          {groupKind && <span className="rounded-xs border border-current px-1 opacity-80">{GROUP_KIND_LABEL[groupKind]}</span>}
          {node.metadata.qualifier && <span className="book italic opacity-80">{String(node.metadata.qualifier)}</span>}
          <span className="tabular ml-auto">{node.sourcePage !== null ? `p. ${node.sourcePage}` : 'sans page'}</span>
        </div>

        {hiddenChildren > 0 && (
          <div className="mt-1 text-[10px] font-medium text-accent">
            +{hiddenChildren} enfant{hiddenChildren > 1 ? 's' : ''} masqué{hiddenChildren > 1 ? 's' : ''}
          </div>
        )}
        {hiddenChildren === 0 && childCount > 0 && node.nodeType !== 'START' && (
          <div className="tabular mt-1 text-[10px] text-ink-faint">
            {childCount} enfant{childCount > 1 ? 's' : ''}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
