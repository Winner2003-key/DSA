import { GraphEditor } from '../../../components/editor/graph-editor';

export const dynamic = 'force-dynamic';

export default async function EditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ noeud?: string }>;
}) {
  const { slug } = await params;
  const { noeud } = await searchParams;
  return <GraphEditor slug={slug} initialNodeId={noeud ?? null} />;
}
