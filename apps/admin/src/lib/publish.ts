import { formatReport, validateGraph, type GraphData, type ValidationIssue } from '@dsa/core';

export interface PublishResult {
  ok: boolean;
  title: string;
  message: string;
  errors: ValidationIssue[];
  report: string | null;
}

/**
 * Publishing is refused while `validateGraph` reports errors: a published graph
 * is what players draw secrets from, and `dsa_create_session` would otherwise
 * fail at the table with `DSA_NO_PLAYABLE_SECRET` or walk a broken branch.
 * Warnings (shared names, reviews still pending) do not block.
 */
export function checkPublishable(data: GraphData): PublishResult {
  const report = validateGraph(data);
  if (!report.ok) {
    return {
      ok: false,
      title: 'Publication refusée',
      message: `Publication refusée : ${report.errors.length} erreur${report.errors.length > 1 ? 's' : ''} de validation.`,
      errors: report.errors,
      report: formatReport(report),
    };
  }
  return {
    ok: true,
    title: 'Graphe publié',
    message: `« ${data.graph.name} » est publié. ${report.stats.playableCharacters} personnages jouables.`,
    errors: [],
    report: null,
  };
}
