/** French wording for the model's enum values. The UI is French, the model is English. */
import type { EdgeKind, GroupKind, NodeType, ReviewStatus } from '@dsa/core';

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  DRAFT: 'Brouillon',
  NEEDS_REVIEW: 'À relire',
  APPROVED: 'Validé',
  REJECTED: 'Rejeté',
};

export const REVIEW_STATUSES: ReviewStatus[] = ['DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED'];

export const NODE_TYPE_LABEL: Record<NodeType, string> = {
  START: 'Départ',
  QUESTION: 'Question',
  CATEGORY: 'Catégorie',
  GROUP: 'Groupe',
  CHARACTER: 'Personnage',
  REFERENCE: 'Renvoi',
  END: 'Fin',
};

export const EDGE_KIND_LABEL: Record<EdgeKind, string> = {
  DECISION: 'Décision',
  HIERARCHY: 'Hiérarchie',
  SYSTEM: 'Système',
};

export const GROUP_KIND_LABEL: Record<GroupKind, string> = {
  CLASSE: 'Classe',
  TOME: 'Tome',
  ALIAS: 'Alias',
  OTHER: 'Autre',
};

/** The five canonical answer codes printed on page 2 of the book. */
export const CANONICAL_ANSWERS = ['OUI', 'NON', 'OUIOUIOUI', 'NONONONON', 'JE NE SAIS PAS'] as const;

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count > 1 ? many : one}`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}
