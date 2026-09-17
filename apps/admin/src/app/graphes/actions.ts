'use server';

import { revalidatePath } from 'next/cache';
import { assertAdmin } from '../../lib/admin-guard';
import { checkPublishable, type PublishResult } from '../../lib/publish';
import { getServerRepository } from '../../lib/repository-server';

export async function publishGraph(slug: string): Promise<PublishResult> {
  await assertAdmin();
  const repository = await getServerRepository();
  const data = await repository.loadGraph(slug);
  const result = checkPublishable(data);
  if (!result.ok) return result;
  await repository.setGraphStatus(data.graph.id, 'PUBLISHED');
  revalidatePath('/graphes');
  return result;
}

export async function unpublishGraph(slug: string): Promise<PublishResult> {
  await assertAdmin();
  const repository = await getServerRepository();
  const data = await repository.loadGraph(slug);
  await repository.setGraphStatus(data.graph.id, 'DRAFT');
  revalidatePath('/graphes');
  return {
    ok: true,
    title: 'Graphe dépublié',
    message: `« ${data.graph.name} » repasse en brouillon : plus aucune nouvelle partie ne peut le tirer.`,
    errors: [],
    report: null,
  };
}
