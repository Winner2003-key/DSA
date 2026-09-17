import { HomonymBoard } from '../../../../components/homonyms/homonym-board';

export const dynamic = 'force-dynamic';

export default async function HomonymsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <HomonymBoard slug={slug} />;
}
