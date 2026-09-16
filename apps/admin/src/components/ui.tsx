import type { ReactNode } from 'react';
import type { NodeType, ReviewStatus } from '@dsa/core';
import { NODE_TYPE_LABEL, REVIEW_STATUS_LABEL } from '../lib/labels';

const STATUS_CLASS: Record<ReviewStatus, string> = {
  DRAFT: 'border-rule-strong bg-draft-soft text-draft',
  NEEDS_REVIEW: 'border-review/40 bg-review-soft text-review',
  APPROVED: 'border-approved/35 bg-approved-soft text-approved',
  REJECTED: 'border-rejected/40 bg-rejected-soft text-rejected',
};

export function StatusBadge({ status, count }: { status: ReviewStatus; count?: number }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-xs border px-1.5 py-px text-[11px] font-medium ${STATUS_CLASS[status]}`}>
      {REVIEW_STATUS_LABEL[status]}
      {count !== undefined && <span className="tabular opacity-70">{count}</span>}
    </span>
  );
}

export function TypeBadge({ type }: { type: NodeType }) {
  return <span className="rounded-xs border border-rule bg-surface-sunk px-1.5 py-px text-[11px] font-medium text-ink-soft">{NODE_TYPE_LABEL[type]}</span>;
}

/**
 * The page number of the printed book, set like a folio. It appears on every
 * node and edge because the PDF is not hosted: the number is how an admin finds
 * the page in the physical book.
 */
export function Folio({ page, printed, extra }: { page: number | null; printed?: number | null; extra?: number[] }) {
  if (page === null) return <span className="text-ink-faint">sans page</span>;
  const more = extra && extra.length > 0 ? ` +${extra.join(', ')}` : '';
  return (
    <span className="tabular text-ink-soft">
      Source : page {page}
      {more}
      {printed != null && printed !== page && <span className="text-ink-faint"> (imprimée {printed})</span>}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="panel px-5 py-8 text-center">
      <p className="text-ink">{title}</p>
      {children && <div className="mt-2 text-ink-soft">{children}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const toneClass = {
    info: 'border-rule bg-surface text-ink',
    warn: 'border-review/40 bg-review-soft text-review',
    error: 'border-rejected/40 bg-rejected-soft text-rejected',
    ok: 'border-approved/35 bg-approved-soft text-approved',
  }[tone];
  return <div className={`rounded-sm border px-3 py-2 ${toneClass}`}>{children}</div>;
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'review' }) {
  return (
    <div>
      <div className={`tabular text-[17px] font-semibold leading-tight ${tone === 'review' ? 'text-review' : 'text-ink'}`}>{value}</div>
      <div className="text-[11px] text-ink-soft">{label}</div>
    </div>
  );
}
