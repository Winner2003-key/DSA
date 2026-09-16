'use server';

import { formatReport, validateGraph, type ValidationIssue } from '@dsa/core';
import { revalidatePath } from 'next/cache';
import { gateOutcome, resolveAccess } from '../../lib/access';
import { MOCK_MODE } from '../../lib/env';
import { getServerRepository } from '../../lib/repository-server';
import { getServerClient } from '../../lib/supabase/server';

export interface PublishResult {
  ok: boolean;
  message: string;
  errors: ValidationIssue[];
  report: string | null;
}

async function assertAdmin(): Promise<void> {
  if (MOCK_MODE) return;
  const access = await resolveAccess(await getServerClient());
  if (gateOutcome(access).render !== 'APP') throw new Error('Accès réservé aux administrateurs');
}

/**
 * Publishing is refused while `validateGraph` reports errors: a published graph
 * is what players draw secrets from, and `dsa_create_session` would otherwise
 * fail at the table with `DSA_NO_PLAYABLE_SECRET` or walk a broken branch.
 */
export async function publishGraph(slug: string): Promise<PublishResult> {
  await assertAdmin();
  const repository = await getServerRepository();
  const data = await repository.loadGraph(slug);
  const report = validateGraph(data);
  if (!report.ok) {
    return {
      ok: false,
      message: `Publication refusée : ${report.errors.length} erreur${report.errors.length > 1 ? 's' : ''} de validation.`,
      errors: report.errors,
      report: formatReport(report),
    };
  }
  await repository.setGraphStatus(data.graph.id, 'PUBLISHED');
  revalidatePath('/graphes');
  return {
    ok: true,
    message: `« ${data.graph.name} » est publié. ${report.stats.playableCharacters} personnages jouables.`,
    errors: [],
    report: null,
  };
}

export async function unpublishGraph(slug: string): Promise<PublishResult> {
  await assertAdmin();
  const repository = await getServerRepository();
  const data = await repository.loadGraph(slug);
  await repository.setGraphStatus(data.graph.id, 'DRAFT');
  revalidatePath('/graphes');
  return { ok: true, message: `« ${data.graph.name} » repasse en brouillon : plus aucune partie ne peut le tirer.`, errors: [], report: null };
}
