'use client';

import type { GraphNode } from '@dsa/core';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RepositoryError } from '../../lib/graph-repository';
import { NODE_HEIGHT, NODE_WIDTH, layoutDagre, layoutTree, resolvePosition } from '../../lib/layout';
import { getBrowserRepository } from '../../lib/repository-browser';
import { searchCharacters, searchNodes } from '../../lib/search';
import { ancestorChain, buildTree, subtreeIds } from '../../lib/tree';
import { draftDiff, toGraphData, useEditorStore, type Draft } from '../../store/editor-store';
import { Notice } from '../ui';
import { AnswerEdge, type AnswerEdgeType } from './answer-edge';
import { EdgeInspector } from './edge-inspector';
import { NodeCard, type NodeCardType } from './node-card';
import { NodeInspector } from './node-inspector';
import { PreviewPanel } from './preview-panel';
import { SaveDialog } from './save-dialog';
import { ValidationPanel } from './validation-panel';

const nodeTypes = { dsa: NodeCard };
const edgeTypes = { dsa: AnswerEdge };

/** Below this many visible cards, React Flow renders everything; above it, only what is on screen. */
const VIRTUALIZE_ABOVE = 200;

type Tab = 'properties' | 'validation' | 'preview';

export function GraphEditor({ slug }: { slug: string }) {
  return (
    <ReactFlowProvider>
      <EditorBody slug={slug} />
    </ReactFlowProvider>
  );
}

function EditorBody({ slug }: { slug: string }) {
  const flow = useReactFlow();
  const load = useEditorStore((s) => s.load);
  const present = useEditorStore((s) => s.present);
  const baseline = useEditorStore((s) => s.baseline);
  const selection = useEditorStore((s) => s.selection);
  const select = useEditorStore((s) => s.select);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const moveNode = useEditorStore((s) => s.moveNode);
  const applyPositions = useEditorStore((s) => s.applyPositions);
  const connect = useEditorStore((s) => s.connect);
  const markSaved = useEditorStore((s) => s.markSaved);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [focusRootId, setFocusRootId] = useState<string | null>(null);
  const [depth, setDepth] = useState(3);
  const [wholeGraph, setWholeGraph] = useState(false);
  const [tab, setTab] = useState<Tab>('properties');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const fitted = useRef(false);

  // ---- loading ------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const repository = await getBrowserRepository();
        const data = await repository.loadGraph(slug);
        if (cancelled) return;
        load(data);
        const start = data.nodes.find((node) => node.nodeType === 'START') ?? data.nodes[0];
        setFocusRootId(start?.id ?? null);
        setLoadError(null);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof RepositoryError ? error.message : String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, load]);

  const tree = useMemo(() => buildTree(present?.nodes ?? [], present?.edges ?? []), [present?.nodes, present?.edges]);

  // Fallback coordinates for nodes the importer never positioned. Recomputed
  // only when the structure changes, not on every text edit.
  const structureKey = useMemo(
    () => `${present?.nodes.length ?? 0}:${present?.edges.map((e) => `${e.id}:${e.orderIndex}`).join() ?? ''}`,
    [present?.nodes.length, present?.edges],
  );
  const fallback = useMemo(
    () => layoutTree(present?.nodes ?? [], present?.edges ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [structureKey],
  );

  const diff = useMemo(() => draftDiff(baseline, present), [baseline, present]);
  const dirty = (diff?.nodes.created.length ?? 0) + (diff?.nodes.updated.length ?? 0) + (diff?.nodes.deleted.length ?? 0) +
    (diff?.edges.created.length ?? 0) + (diff?.edges.updated.length ?? 0) + (diff?.edges.deleted.length ?? 0) +
    (diff?.characters.created.length ?? 0) + (diff?.characters.updated.length ?? 0) + (diff?.characters.deleted.length ?? 0);

  // ---- unsaved-changes guard ----------------------------------------------
  useEffect(() => {
    if (dirty === 0) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ---- undo / redo shortcuts ----------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (key === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // ---- visible slice ------------------------------------------------------
  const visibleIds = useMemo(() => {
    if (!present) return new Set<string>();
    if (wholeGraph || !focusRootId) return new Set(present.nodes.map((node) => node.id));
    return subtreeIds(tree, focusRootId, depth);
  }, [present, wholeGraph, focusRootId, depth, tree]);

  const rfNodes = useMemo<NodeCardType[]>(() => {
    if (!present) return [];
    return present.nodes
      .filter((node) => visibleIds.has(node.id))
      .map((node) => {
        const childEdges = tree.childEdges.get(node.id) ?? [];
        const hidden = childEdges.filter((edge) => !visibleIds.has(edge.toNodeId)).length;
        return {
          id: node.id,
          type: 'dsa' as const,
          position: resolvePosition(node, fallback),
          selected: selection?.kind === 'node' && selection.id === node.id,
          data: {
            node,
            incomingLabel: incomingLabel(tree.parentEdges.get(node.id)?.[0]?.answerLabel ?? null, node),
            childCount: childEdges.length,
            hiddenChildren: hidden,
            matched: highlight.has(node.id),
          },
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
        };
      });
  }, [present, visibleIds, tree, fallback, selection, highlight]);

  const rfEdges = useMemo<AnswerEdgeType[]>(() => {
    if (!present) return [];
    return present.edges
      .filter((edge) => visibleIds.has(edge.fromNodeId) && visibleIds.has(edge.toNodeId))
      .map((edge) => ({
        id: edge.id,
        type: 'dsa' as const,
        source: edge.fromNodeId,
        target: edge.toNodeId,
        selected: selection?.kind === 'edge' && selection.id === edge.id,
        data: { edge },
      }));
  }, [present, visibleIds, selection]);

  // ---- navigation ---------------------------------------------------------
  const centerOn = useCallback(
    (nodeId: string) => {
      const node = tree.nodesById.get(nodeId);
      if (!node) return;
      const position = resolvePosition(node, fallback);
      flow.setCenter(position.x + NODE_WIDTH / 2, position.y + NODE_HEIGHT / 2, { zoom: Math.max(flow.getZoom(), 0.75), duration: 300 });
    },
    [flow, fallback, tree],
  );

  const jumpTo = useCallback(
    (nodeId: string) => {
      select({ kind: 'node', id: nodeId });
      setTab('properties');
      if (!wholeGraph && !visibleIds.has(nodeId)) {
        // Open the focus on the node's parent, so the node arrives with context.
        const chain = ancestorChain(tree, nodeId);
        const anchor = chain[Math.max(0, chain.length - 2)];
        setFocusRootId(anchor?.id ?? nodeId);
      }
      setHighlight(new Set([nodeId]));
      window.setTimeout(() => centerOn(nodeId), 60);
    },
    [select, wholeGraph, visibleIds, tree, centerOn],
  );

  const jumpToKey = useCallback(
    (nodeKey: string) => {
      const node = present?.nodes.find((candidate) => candidate.nodeKey === nodeKey);
      if (node) jumpTo(node.id);
    },
    [present, jumpTo],
  );

  useEffect(() => {
    if (!fitted.current && rfNodes.length > 0) {
      fitted.current = true;
      window.setTimeout(() => flow.fitView({ padding: 0.2, duration: 0 }), 30);
    }
  }, [rfNodes.length, flow]);

  // ---- search -------------------------------------------------------------
  const nodeHits = useMemo(() => searchNodes(present?.nodes ?? [], term, 8), [present, term]);
  const characterHits = useMemo(() => searchCharacters(present?.characters ?? [], term, 6), [present, term]);

  const selectedNode = selection?.kind === 'node' ? tree.nodesById.get(selection.id) : undefined;
  const selectedEdge = selection?.kind === 'edge' ? tree.edgesById.get(selection.id) : undefined;
  const breadcrumbs = focusRootId ? ancestorChain(tree, focusRootId) : [];

  if (loading) return <div className="flex h-full items-center justify-center text-ink-soft">Chargement du graphe…</div>;
  if (loadError)
    return (
      <div className="mx-auto max-w-lg px-6 py-10">
        <Notice tone="error">{loadError}</Notice>
        <p className="mt-3">
          <Link className="btn" href="/graphes">
            Retour aux graphes
          </Link>
        </p>
      </div>
    );
  if (!present) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* --- command bar --- */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-rule bg-surface px-3 py-2">
        <Link href="/graphes" className="text-ink-faint hover:text-ink" title="Retour aux graphes">
          ←
        </Link>
        <span className="font-medium">{present.graph.name}</span>
        <span className="text-ink-faint">{present.graph.slug}</span>

        <div className="relative ml-3 w-72">
          <input
            className="field"
            placeholder="Chercher un libellé, un indice, une clé, un personnage…"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
          {term.trim() !== '' && (
            <div className="absolute left-0 top-full z-30 mt-1 max-h-96 w-[28rem] overflow-auto rounded-sm border border-rule bg-surface shadow-lg">
              {nodeHits.length === 0 && characterHits.length === 0 && <p className="px-2 py-2 text-ink-faint">Aucun résultat.</p>}
              {nodeHits.map((hit) => (
                <button
                  key={hit.node.id}
                  type="button"
                  className="block w-full border-b border-rule px-2 py-1.5 text-left last:border-0 hover:bg-surface-sunk"
                  onClick={() => {
                    jumpTo(hit.node.id);
                    setTerm('');
                  }}
                >
                  <span className="book text-[14px]">{hit.node.label}</span>
                  {hit.node.question && <span className="book text-[12px] italic text-ink-soft"> · {hit.node.question}</span>}
                  <span className="block truncate text-[11px] text-ink-faint">
                    {hit.node.nodeKey} {hit.node.sourcePage !== null && `· p. ${hit.node.sourcePage}`}
                  </span>
                </button>
              ))}
              {characterHits.length > 0 && (
                <p className="border-b border-rule bg-surface-sunk px-2 py-1 text-[11px] text-ink-soft">Personnages</p>
              )}
              {characterHits.map((hit) => {
                const target = present.nodes.find((node) => node.characterId === hit.character.id);
                return (
                  <button
                    key={hit.character.id}
                    type="button"
                    className="block w-full border-b border-rule px-2 py-1.5 text-left last:border-0 hover:bg-surface-sunk disabled:opacity-50"
                    disabled={!target}
                    onClick={() => {
                      if (target) jumpTo(target.id);
                      setTerm('');
                    }}
                  >
                    <span className="book text-[14px]">{hit.character.name}</span>
                    {hit.character.description && <span className="book block text-[11px] italic text-ink-faint">{hit.character.description}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" className="btn" onClick={undo} disabled={!canUndo} title="Annuler (Ctrl+Z)">
            Annuler
          </button>
          <button type="button" className="btn" onClick={redo} disabled={!canRedo} title="Rétablir (Ctrl+Maj+Z)">
            Rétablir
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => applyPositions(layoutTree(present.nodes, present.edges))}
            title="Replacer les cartes en arbre, enfants dans l’ordre du livre"
          >
            Ranger
          </button>
          <button type="button" className="btn" onClick={() => applyPositions(layoutDagre(present.nodes, present.edges))} title="Disposition en couches (dagre)">
            Couches
          </button>
          <button type="button" className="btn" onClick={() => exportJson(present)}>
            Exporter JSON
          </button>
          <button type="button" className="btn btn-primary" disabled={dirty === 0} onClick={() => setSaving(true)}>
            Enregistrer{dirty > 0 ? ` (${dirty})` : ''}
          </button>
        </div>
      </div>

      {/* --- focus bar --- */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-rule bg-paper px-3 py-1.5">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={wholeGraph} onChange={(event) => setWholeGraph(event.target.checked)} />
          <span>Graphe entier</span>
        </label>
        {!wholeGraph && (
          <>
            <span className="text-ink-faint">Profondeur</span>
            <input
              type="range"
              min={1}
              max={8}
              value={depth}
              onChange={(event) => setDepth(Number.parseInt(event.target.value, 10))}
              className="w-28 accent-accent"
            />
            <span className="tabular w-4 text-ink-soft">{depth}</span>
            <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden" aria-label="Fil d’Ariane">
              {breadcrumbs.map((node, index) => (
                <span key={node.id} className="flex min-w-0 items-center gap-1">
                  {index > 0 && <span className="text-ink-faint">›</span>}
                  <button
                    type="button"
                    className={`book max-w-52 truncate rounded-xs px-1 text-[13px] hover:bg-surface-sunk ${
                      node.id === focusRootId ? 'font-semibold text-ink' : 'text-ink-soft'
                    }`}
                    onClick={() => setFocusRootId(node.id)}
                  >
                    {node.label}
                  </button>
                </span>
              ))}
            </nav>
          </>
        )}
        <span className="tabular ml-auto text-ink-faint">
          {rfNodes.length.toLocaleString('fr-FR')} / {present.nodes.length.toLocaleString('fr-FR')} nœuds affichés
        </span>
      </div>

      {/* --- canvas + inspector --- */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <ReactFlow<NodeCardType, AnswerEdgeType>
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onlyRenderVisibleElements={rfNodes.length > VIRTUALIZE_ABOVE}
            minZoom={0.05}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            nodesDraggable
            elevateNodesOnSelect={false}
            onNodesChange={(changes: NodeChange<NodeCardType>[]) => {
              // Every step of a drag merges into one history entry (merge key
              // `move:<id>` in the store), so Ctrl+Z undoes the whole drag.
              for (const change of changes) {
                if (change.type === 'position' && change.position) moveNode(change.id, change.position);
              }
            }}
            onNodeClick={(_, node: Node) => {
              select({ kind: 'node', id: node.id });
              setTab('properties');
            }}
            onNodeDoubleClick={(_, node: Node) => setFocusRootId(node.id)}
            onEdgeClick={(_, edge: Edge) => {
              select({ kind: 'edge', id: edge.id });
              setTab('properties');
            }}
            onPaneClick={() => select(null)}
            onConnect={(connection: Connection) => {
              if (connection.source && connection.target) connect(connection.source, connection.target);
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#c9d3db" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeStrokeWidth={2} nodeColor={minimapColor} maskColor="rgba(22, 32, 43, 0.06)" />
          </ReactFlow>
        </div>

        <aside className="flex w-[22rem] shrink-0 flex-col border-l border-rule bg-surface xl:w-[24rem]">
          <div className="flex shrink-0 border-b border-rule">
            {(
              [
                ['properties', 'Propriétés'],
                ['validation', 'Valider'],
                ['preview', 'Aperçu de partie'],
              ] as [Tab, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`flex-1 border-b-2 px-2 py-2 font-medium ${tab === value ? 'border-accent text-accent' : 'border-transparent text-ink-soft hover:text-ink'}`}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'properties' &&
              (selectedNode ? (
                <NodeInspector node={selectedNode} onJump={jumpTo} />
              ) : selectedEdge ? (
                <EdgeInspector edge={selectedEdge} onJump={jumpTo} />
              ) : (
                <p className="p-4 text-ink-soft">
                  Cliquez une carte ou une réponse pour l’éditer. Double-cliquez une carte pour n’afficher qu’elle et ses descendants.
                </p>
              ))}
            {tab === 'validation' && <ValidationPanel onJumpToKey={jumpToKey} />}
            {tab === 'preview' && <PreviewPanel onJump={jumpTo} />}
          </div>
        </aside>
      </div>

      {saving && diff && (
        <SaveDialog
          diff={diff}
          onCancel={() => setSaving(false)}
          onSaved={(message) => {
            markSaved();
            setSaving(false);
            setToast(message);
            window.setTimeout(() => setToast(null), 6000);
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-sm border border-approved/35 bg-approved-soft px-3 py-2 text-approved shadow-md">
          {toast}
        </div>
      )}
    </div>
  );
}

/** SYSTEM edges carry "DÉBUT", which says nothing on a card; every other answer does. */
function incomingLabel(answerLabel: string | null, node: GraphNode): string | null {
  if (!answerLabel || node.nodeType === 'START') return null;
  return answerLabel === 'DÉBUT' ? null : answerLabel;
}

function minimapColor(node: Node): string {
  const status = (node.data as { node?: GraphNode }).node?.reviewStatus;
  if (status === 'NEEDS_REVIEW') return '#b45309';
  if (status === 'REJECTED') return '#b42318';
  if (status === 'APPROVED') return '#15803d';
  return '#7c8b9b';
}

function exportJson(present: Draft): void {
  const data = toGraphData(present);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${present.graph.slug}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
