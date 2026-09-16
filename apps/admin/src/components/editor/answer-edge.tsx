'use client';

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';
import type { GraphEdge } from '@dsa/core';

export interface AnswerEdgeData extends Record<string, unknown> {
  edge: GraphEdge;
}

export type AnswerEdgeType = Edge<AnswerEdgeData, 'dsa'>;

const TONE = {
  DRAFT: 'border-rule text-ink-faint',
  NEEDS_REVIEW: 'border-review/60 bg-review-soft! text-review',
  APPROVED: 'border-rule text-ink-soft',
  REJECTED: 'border-rejected/60 bg-rejected-soft! text-rejected',
} as const;

/**
 * Every edge shows the answer that walks it, so the canvas reads the way the
 * Découvreur plays: question, answer, next question.
 */
export function AnswerEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<AnswerEdgeType>) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 6 });
  const edge = data?.edge;

  return (
    <>
      <BaseEdge id={id} path={path} />
      {edge && (
        <EdgeLabelRenderer>
          <div
            className={`edge-chip ${TONE[edge.reviewStatus]} ${selected ? 'border-accent! text-accent!' : ''}`}
            style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {edge.answerLabel}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
