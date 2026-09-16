import { GraphEditor } from '../../../components/editor/graph-editor';

export const dynamic = 'force-dynamic';

export default async function EditorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <GraphEditor slug={slug} />;
}
