'use server';

import { revalidatePath } from 'next/cache';
import { assertAdmin } from '../../../../lib/admin-guard';
import { getServerRepository } from '../../../../lib/repository-server';

export interface ReviewResult {
  ok: boolean;
  message: string;
}

async function review(slug: string, pages: number[], status: 'APPROVED' | 'REJECTED', note: string | null): Promise<ReviewResult> {
  await assertAdmin();
  const clean = [...new Set(pages.filter((page) => Number.isInteger(page) && page > 0))];
  if (clean.length === 0) return { ok: false, message: 'Aucune page sélectionnée.' };
  try {
    const repository = await getServerRepository();
    const data = await repository.loadGraph(slug);
    const touched = await repository.reviewPages(data.graph.id, clean, status, note);
    revalidatePath(`/graphes/${slug}/revue`);
    revalidatePath('/graphes');
    const what = clean.length > 1 ? `Pages ${clean.join(', ')}` : `Page ${clean[0]}`;
    const verb = status === 'APPROVED' ? (clean.length > 1 ? 'approuvées' : 'approuvée') : 'rejetée';
    return { ok: true, message: `${what} ${verb} (${touched} lignes).` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function approvePages(slug: string, pages: number[]): Promise<ReviewResult> {
  return review(slug, pages, 'APPROVED', null);
}

export async function rejectPage(slug: string, page: number, note: string): Promise<ReviewResult> {
  if (note.trim() === '') return { ok: false, message: 'Indiquez ce qui ne va pas sur la page avant de la rejeter.' };
  return review(slug, [page], 'REJECTED', note.trim());
}
