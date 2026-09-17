import Link from 'next/link';
import { ReviewBoard } from '../../../../components/review/review-board';
import { Notice } from '../../../../components/ui';
import { RepositoryError } from '../../../../lib/graph-repository';
import { getServerRepository } from '../../../../lib/repository-server';
import { buildPageReviews, pageTree } from '../../../../lib/review';

export const dynamic = 'force-dynamic';

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page: pageParam } = await searchParams;

  try {
    const repository = await getServerRepository();
    const data = await repository.loadGraph(slug);
    const batches = await repository.listImportBatches(data.graph.id);
    const reviews = buildPageReviews(data, batches);
    const openPage = pageParam ? Number.parseInt(pageParam, 10) : null;
    const open = openPage !== null ? (reviews.find((review) => review.page === openPage) ?? null) : null;

    return (
      <ReviewBoard
        slug={slug}
        graphName={data.graph.name}
        reviews={reviews}
        open={open}
        openItems={open ? pageTree(data, open.page) : []}
        unpaged={data.nodes.filter((node) => node.sourcePage === null).length}
      />
    );
  } catch (error) {
    return (
      <main className="mx-auto max-w-lg px-6 py-10">
        <Notice tone="error">{error instanceof RepositoryError ? error.message : String(error)}</Notice>
        <p className="mt-3">
          <Link className="btn" href="/graphes">
            Retour aux graphes
          </Link>
        </p>
      </main>
    );
  }
}
