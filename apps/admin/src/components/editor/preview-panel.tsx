'use client';

import { GameEngine, GraphIndex, answerLabelsFor, isEngineError, type EngineState, type GraphNode } from '@dsa/core';
import { useMemo, useState } from 'react';
import { toGraphData, useEditorStore } from '../../store/editor-store';

/**
 * Plays the graph in the browser with the real `GameEngine`, so an admin can
 * check that a path actually reaches the name they expect. This is a bench
 * test, not a game: it never touches `game_sessions`, and it shows the secret
 * on purpose.
 */
export function PreviewPanel({ onJump }: { onJump: (nodeId: string) => void }) {
  const present = useEditorStore((s) => s.present);
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [state, setState] = useState<EngineState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState('');

  const index = useMemo(() => (present ? new GraphIndex(toGraphData(present), { approvedOnly }) : null), [present, approvedOnly]);
  const engine = useMemo(() => (index ? new GameEngine(index) : null), [index]);
  const candidates = useMemo(() => (index ? index.playableCharacters() : []), [index]);

  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const list = needle === '' ? candidates : candidates.filter((c) => c.label.toLowerCase().includes(needle));
    return list.slice(0, 12);
  }, [candidates, term]);

  function run(action: () => EngineState): void {
    try {
      setState(action());
      setError(null);
    } catch (cause) {
      setError(isEngineError(cause) ? `${cause.code} — ${cause.message}` : String(cause));
    }
  }

  function start(secret: GraphNode): void {
    if (!engine) return;
    run(() => engine.newGame(secret.id));
  }

  const prompt = engine && state && state.status === 'PLAYING' ? engine.prompt(state) : null;
  const secret = state?.secretNodeId ? index?.node(state.secretNodeId) : undefined;

  return (
    <div className="space-y-3 p-3 pb-6">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={approvedOnly} onChange={(e) => { setApprovedOnly(e.target.checked); setState(null); }} />
        <span>Ne jouer que les nœuds validés (comme une vraie partie)</span>
      </label>

      <p className="text-ink-faint">
        {candidates.length.toLocaleString('fr-FR')} personnage{candidates.length > 1 ? 's' : ''} atteignable{candidates.length > 1 ? 's' : ''} depuis le départ.
      </p>

      {!state && (
        <div className="space-y-2">
          <input className="field" placeholder="Choisir un secret…" value={term} onChange={(e) => setTerm(e.target.value)} />
          {candidates.length === 0 ? (
            <p className="rounded-sm border border-review/40 bg-review-soft px-2 py-1.5 text-review">
              Aucun personnage jouable. {approvedOnly ? 'Validez des nœuds et des arêtes, ou décochez la case ci-dessus.' : 'Vérifiez que le départ mène bien à des personnages.'}
            </p>
          ) : (
            <ul className="divide-y divide-rule rounded-sm border border-rule">
              {visible.map((candidate) => (
                <li key={candidate.id}>
                  <button type="button" className="block w-full px-2 py-1.5 text-left hover:bg-surface-sunk" onClick={() => start(candidate)}>
                    <span className="book text-[14px]">{candidate.label}</span>
                    {candidate.description && <span className="book block text-[11px] italic text-ink-faint">{candidate.description}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {state && engine && (
        <div className="space-y-3">
          <div className="rounded-sm border border-rule bg-surface-sunk px-2 py-1.5">
            <div className="text-[11px] text-ink-soft">Secret (visible pour le test)</div>
            <button type="button" className="book text-[15px] font-semibold underline-offset-2 hover:text-accent hover:underline" onClick={() => secret && onJump(secret.id)}>
              {secret?.label ?? '—'}
            </button>
          </div>

          <ol className="space-y-1">
            {engine.revealedPath(state).map((step, index) =>
              step.kind === 'STEP' ? (
                <li key={`${step.index}-${index}`} className="flex items-baseline gap-2 border-b border-rule pb-1">
                  <span className="tabular w-5 shrink-0 text-ink-faint">{step.index + 1}</span>
                  <span className="book flex-1 text-[13px]">{step.text}</span>
                  <span className="shrink-0 text-[11px] font-semibold text-accent">{step.answerLabel}</span>
                </li>
              ) : (
                <li key={`name-${index}`} className="book pt-1 text-[16px] font-semibold text-approved">
                  {step.name} ⭐
                </li>
              ),
            )}
          </ol>

          {state.status === 'PLAYING' && (
            <div className="space-y-2">
              {state.awaiting === 'QUESTION' && prompt && (
                <>
                  <p className="book rounded-sm border border-rule bg-surface px-2 py-1.5 text-[14px]">{prompt.text}</p>
                  <button type="button" className="btn btn-primary w-full" onClick={() => run(() => engine.ask(state))}>
                    Poser la question
                  </button>
                </>
              )}

              {state.awaiting === 'QUESTION' && !prompt && (
                <p className="rounded-sm border border-review/40 bg-review-soft px-2 py-1.5 text-review">
                  Cul-de-sac : la liste est épuisée. Le Découvreur doit revenir en arrière.
                </p>
              )}

              {state.awaiting === 'ANSWER' && prompt && (
                <div className="flex flex-wrap gap-1">
                  {answerLabelsFor(index!, prompt).map((label) => (
                    <button key={label} type="button" className="btn" onClick={() => run(() => engine.answer(state, label))}>
                      {label}
                    </button>
                  ))}
                  <button type="button" className="btn btn-primary" onClick={() => run(() => engine.answer(state, engine.aiTireurAnswer(state)))}>
                    Réponse juste
                  </button>
                </div>
              )}

              {state.awaiting === 'GUESS_CONFIRM' && (
                <div className="flex gap-2">
                  <button type="button" className="btn flex-1" onClick={() => run(() => engine.confirmGuess(state, 'OUI'))}>
                    OUI
                  </button>
                  <button type="button" className="btn flex-1" onClick={() => run(() => engine.confirmGuess(state, 'NON'))}>
                    NON
                  </button>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn flex-1"
                  disabled={state.awaiting !== 'QUESTION'}
                  onClick={() => {
                    const name = window.prompt('Nom appelé par le Découvreur ?');
                    if (name) run(() => engine.guess(state, name));
                  }}
                >
                  Appeler un nom
                </button>
                <button type="button" className="btn flex-1" disabled={state.steps.length === 0} onClick={() => run(() => engine.goBack(state, state.steps.length - 1))}>
                  Revenir
                </button>
              </div>
            </div>
          )}

          {state.status === 'DISCOVERED' && <p className="rounded-sm border border-approved/35 bg-approved-soft px-2 py-1.5 text-approved">🎉 Nom trouvé.</p>}

          {error && <p className="rounded-sm border border-rejected/40 bg-rejected-soft px-2 py-1.5 text-rejected">{error}</p>}

          <button type="button" className="btn w-full" onClick={() => { setState(null); setError(null); }}>
            Nouvelle partie
          </button>
        </div>
      )}
    </div>
  );
}
