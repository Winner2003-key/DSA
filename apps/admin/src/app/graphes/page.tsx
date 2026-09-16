import Link from 'next/link';
import { getServerRepository } from '../../lib/repository-server';
import { RepositoryError, type GraphSummary } from '../../lib/graph-repository';
import { PublishControls } from '../../components/publish-controls';
import { Empty, Notice } from '../../components/ui';
import { plural } from '../../lib/labels';

export const dynamic = 'force-dynamic';

export default async function GraphesPage() {
  let graphs: GraphSummary[] = [];
  let failure: string | null = null;
  try {
    graphs = await (await getServerRepository()).listGraphs();
  } catch (error) {
    failure = error instanceof RepositoryError ? error.message : String(error);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <h1 className="text-xl font-semibold tracking-tight">Graphes</h1>
      <p className="mt-1 max-w-[70ch] text-ink-soft">
        Un graphe par transcription du livre. Ouvrez l’éditeur pour corriger la structure, ou la revue pour valider les pages importées.
      </p>

      {failure && (
        <div className="mt-5">
          <Notice tone="error">{failure}</Notice>
        </div>
      )}

      {!failure && graphs.length === 0 && (
        <div className="mt-5">
          <Empty title="Aucun graphe pour l’instant.">
            Lancez l’import du livre (<code className="rounded-xs bg-surface-sunk px-1">npm run book:import -- --apply</code>), puis rechargez cette
            page. Si l’import a déjà tourné, vérifiez que votre compte figure dans <code className="rounded-xs bg-surface-sunk px-1">admin_users</code>.
          </Empty>
        </div>
      )}

      {graphs.length > 0 && (
        <div className="panel mt-5 rounded-md">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-rule text-[11px] font-medium text-ink-soft">
                <th className="px-4 py-2 font-medium">Graphe</th>
                <th className="px-3 py-2 font-medium">Statut</th>
                <th className="px-3 py-2 text-right font-medium">Version</th>
                <th className="px-3 py-2 text-right font-medium">Nœuds</th>
                <th className="px-3 py-2 text-right font-medium">Arêtes</th>
                <th className="px-3 py-2 text-right font-medium">Personnages</th>
                <th className="px-3 py-2 text-right font-medium">À relire</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {graphs.map((graph) => {
                const toReview = graph.needsReviewNodes + graph.needsReviewEdges;
                return (
                  <tr key={graph.id} className="border-b border-rule last:border-0 align-middle">
                    <td className="px-4 py-3">
                      <Link href={`/graphes/${graph.slug}`} className="font-medium text-ink underline-offset-2 hover:text-accent hover:underline">
                        {graph.name}
                      </Link>
                      <div className="text-ink-faint">
                        {graph.slug}
                        {!graph.isActive && ' · inactif'}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-xs border px-1.5 py-px text-[11px] font-medium ${
                          graph.status === 'PUBLISHED' ? 'border-approved/35 bg-approved-soft text-approved' : 'border-rule-strong bg-draft-soft text-draft'
                        }`}
                      >
                        {graph.status === 'PUBLISHED' ? 'Publié' : 'Brouillon'}
                      </span>
                    </td>
                    <td className="tabular px-3 py-3 text-right text-ink-soft">{graph.version}</td>
                    <td className="tabular px-3 py-3 text-right">{graph.nodes.toLocaleString('fr-FR')}</td>
                    <td className="tabular px-3 py-3 text-right">{graph.edges.toLocaleString('fr-FR')}</td>
                    <td className="tabular px-3 py-3 text-right">{graph.characters.toLocaleString('fr-FR')}</td>
                    <td className="tabular px-3 py-3 text-right">
                      {toReview > 0 ? (
                        <Link href={`/graphes/${graph.slug}/revue`} className="text-review underline-offset-2 hover:underline">
                          {toReview.toLocaleString('fr-FR')}
                        </Link>
                      ) : (
                        <span className="text-ink-faint">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/graphes/${graph.slug}`} className="btn">
                          Ouvrir
                        </Link>
                        <Link href={`/graphes/${graph.slug}/revue`} className="btn">
                          Revue
                        </Link>
                        <PublishControls slug={graph.slug} status={graph.status} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {graphs.length > 0 && (
        <p className="mt-3 text-ink-faint">
          {plural(graphs.length, 'graphe')} · un graphe publié et actif est jouable par les applications.
        </p>
      )}
    </main>
  );
}
