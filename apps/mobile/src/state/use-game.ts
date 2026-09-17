import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { Awaiting, Role } from '@dsa/core';

import { getGameService } from '@/services';
import { DsaError, toDsaError } from '@/services/errors';
import type { GameService } from '@/services/game-service';
import { FALLBACK_POLL_MS, type RealtimeStatus } from '@/services/realtime-sync';
import type { GameState } from '@/services/types';
import { buildExchanges, pruneGuesses, type Exchange, type GuessRecord } from './exchanges';

/** How long the AI Découvreur "thinks" before acting, so a turn feels human. */
export const AI_THINKING_MS = 900;
/**
 * The AI Tireur answers in the same round trip. Holding the answer back this long
 * shows "Le Tireur réfléchit…" with the question just asked, so the answer lands
 * as a separate beat instead of replacing the question in the same frame.
 */
export const AI_ANSWER_BEAT_MS = 700;
/**
 * A room whose push channel has been down this long, or whose last refresh failed
 * for lack of network, shows "Connexion perdue… reconnexion".
 */
export const CONNECTION_LOST_AFTER_MS = 4000;
/** A stuck AI must not spin forever against a mistaken human Tireur. */
const MAX_AI_STEPS_IN_A_ROW = 24;

/**
 * Where the table is, for every mode:
 *
 *   LOBBY         a room waits for its second player (status WAITING)
 *   TIREUR_READY  the Tireur looks at the card before the first question —
 *                 LOCAL: a client-side step (GRAPH_SPECIFICATION §8);
 *                 rooms: the server's `tireur_ready` (dsa_tireur_ready, brief S6).
 *                 This is the one phase the §9 thinking time will be put on.
 *   PLAYING       questions and answers
 *   ENDED         DISCOVERED or ABANDONED
 */
export type TablePhase = 'LOBBY' | 'TIREUR_READY' | 'PLAYING' | 'ENDED';

/** Sessions whose Tireur already said "je suis prêt" on this device. */
const tireurReadySessions = new Set<string>();

/** What this device just sent and is waiting to hear back about. */
export type Outgoing = { kind: 'ASK'; text: string } | { kind: 'GUESS'; name: string };

export interface UseGame {
  state: GameState | null;
  loading: boolean;
  /** An action is in flight; the UI disables its buttons. */
  busy: boolean;
  error: DsaError | null;
  clearError: () => void;

  /** Roles this device holds. LOCAL holds both. */
  myRoles: Role[];
  isLocal: boolean;
  /** Whose turn it is, from `awaiting`. */
  activeRole: Role | null;
  /** True while the AI Découvreur is about to play. */
  aiThinking: boolean;
  /**
   * The question or name this device sent while the answer is not in yet — also
   * during the AI Tireur's short beat, when the server has in fact already answered.
   */
  outgoing: Outgoing | null;
  /**
   * The last name the Tireur refused, until the next move. Kept here rather than
   * in a view: AI_TIREUR refuses in the same round trip (so `pending_guess` is
   * never seen), and in LOCAL the Découvreur view is unmounted while the Tireur
   * answers.
   */
  refusedGuess: string | null;
  /** Every question paired with its own answer, and every refused name call, in order. */
  exchanges: Exchange[];
  /** null until the first state arrives. */
  phase: TablePhase | null;
  /** "C’est bon, je suis prêt": client-side in LOCAL, `dsa_tireur_ready` in a room. */
  confirmTireurReady: () => void;
  /** A room (HUMAN_VS_HUMAN) that is still open: it is kept in sync over Realtime. */
  isRoom: boolean;
  /** The push channel, for a room; null otherwise. */
  realtimeStatus: RealtimeStatus | null;
  /** A room lost its connection for a while (channel down, or a refresh failed for lack of network). */
  connectionLost: boolean;

  refresh: () => Promise<void>;
  ask: () => Promise<void>;
  answer: (answerLabel: string) => Promise<void>;
  guess: (name: string) => Promise<void>;
  confirmGuess: (answerLabel: 'OUI' | 'NON') => Promise<void>;
  goBack: (stepIndex: number) => Promise<void>;
  rewind: (count: 1 | 2 | 3) => Promise<void>;
  abandon: () => Promise<void>;
}

export function roleFor(awaiting: Awaiting): Role | null {
  switch (awaiting) {
    case 'QUESTION':
      return 'DECOUVREUR';
    case 'ANSWER':
    case 'GUESS_CONFIRM':
      return 'TIREUR';
    default:
      return null;
  }
}

export interface UseGameOptions {
  /** Injected in tests; defaults to the app-wide service. */
  service?: GameService;
  /** Set to 0 in tests to make the AI Découvreur act immediately. */
  aiThinkingMs?: number;
  /** Set to 0 in tests: the AI Tireur's answer is shown at once. */
  aiAnswerBeatMs?: number;
  /** Injected in tests. */
  connectionLostAfterMs?: number;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One game, seen from this device. It owns fetching, the refresh strategy, the AI
 * Découvreur's turns and the LOCAL hand-over phase; it owns no rules. Every
 * mutating call returns the new state JSON, so a successful action needs no extra
 * round trip.
 */
export function useGame(sessionId: string | null, options: UseGameOptions = {}): UseGame {
  const service = useMemo(() => options.service ?? getGameService(), [options.service]);
  const thinkingMs = options.aiThinkingMs ?? AI_THINKING_MS;
  const answerBeatMs = options.aiAnswerBeatMs ?? AI_ANSWER_BEAT_MS;
  const lostAfterMs = options.connectionLostAfterMs ?? CONNECTION_LOST_AFTER_MS;

  const [state, setState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DsaError | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [refusedGuess, setRefusedGuess] = useState<string | null>(null);
  const [guesses, setGuesses] = useState<GuessRecord[]>([]);
  const [outgoing, setOutgoing] = useState<Outgoing | null>(null);
  const [tireurReady, setTireurReady] = useState(() => (sessionId ? tireurReadySessions.has(sessionId) : false));
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus | null>(null);
  const [channelDown, setChannelDown] = useState(false);
  const [networkDown, setNetworkDown] = useState(false);
  const [resubscribeTick, setResubscribeTick] = useState(0);

  const mounted = useRef(true);
  const inFlight = useRef(false);
  const aiSteps = useRef(0);
  const latest = useRef<GameState | null>(null);
  /** A push arrived while an action was in flight: read the state again afterwards. */
  const refreshAfterAction = useRef(false);
  /** Responses can arrive out of order; only the newest request's state is kept. */
  const requestSeq = useRef(0);
  const acceptedSeq = useRef(0);

  /** Stores a new state and notices a name call that just came back refused. */
  const accept = useCallback((next: GameState, calledName: string | null = null) => {
    const previous = latest.current;
    latest.current = next;
    setState(next);
    const stillHere = next.status === 'PLAYING' && next.pending_guess === null;
    let refused: string | null = null;
    if (stillHere && previous?.pending_guess) refused = previous.pending_guess;
    else if (stillHere && calledName !== null && next.awaiting === 'QUESTION') refused = calledName;

    if (refused !== null) {
      const name = refused;
      setRefusedGuess(name);
      setGuesses((list) => [...pruneGuesses(list, next.path.length), { afterSteps: next.path.length, name }]);
    } else {
      if (previous && next.path.length !== previous.path.length) setRefusedGuess(null);
      if (previous && next.path.length < previous.path.length) {
        setGuesses((list) => pruneGuesses(list, next.path.length));
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  /** Keeps a response only if no newer request has already been applied. */
  const isFresh = (seq: number) => {
    if (seq < acceptedSeq.current) return false;
    acceptedSeq.current = seq;
    return true;
  };

  /**
   * Reads the state. A background refresh (push, poll, foreground) reports a lost
   * network through `connectionLost` rather than as an error banner on every poll.
   */
  const load = useCallback(
    async (background: boolean) => {
      if (!sessionId) return;
      const seq = ++requestSeq.current;
      try {
        const next = await service.getState(sessionId);
        if (mounted.current && isFresh(seq)) {
          accept(next);
          setError(null);
          setNetworkDown(false);
        }
      } catch (caught) {
        if (!mounted.current) return;
        const failure = toDsaError(caught);
        if (failure.code === 'NETWORK') setNetworkDown(true);
        if (!background || failure.code !== 'NETWORK') setError(failure);
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [accept, service, sessionId],
  );

  const refresh = useCallback(() => load(false), [load]);

  /** Push, poll and foreground refreshes: never on top of an action in flight. */
  const pushRefresh = useCallback(() => {
    if (inFlight.current) {
      refreshAfterAction.current = true;
      return;
    }
    void load(true);
  }, [load]);

  useEffect(() => {
    setLoading(true);
    setState(null);
    latest.current = null;
    setRefusedGuess(null);
    setGuesses([]);
    setOutgoing(null);
    setTireurReady(sessionId ? tireurReadySessions.has(sessionId) : false);
    setRealtimeStatus(null);
    setNetworkDown(false);
    aiSteps.current = 0;
    void refresh();
  }, [refresh, sessionId]);

  /** Runs one action, keeps the returned state, and maps failures to French. */
  const run = useCallback(
    async (
      action: (id: string) => Promise<GameState>,
      isHumanMove: boolean,
      calledName: string | null = null,
      sent: Outgoing | null = null,
    ) => {
      if (!sessionId || inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      if (isHumanMove) aiSteps.current = 0;
      if (isHumanMove) setRefusedGuess(null);
      if (sent) setOutgoing(sent);
      const startedAt = Date.now();
      const seq = ++requestSeq.current;
      try {
        const next = await action(sessionId);
        // Only the AI Tireur answers inside the same call; give that answer its own beat.
        if (sent && next.mode === 'AI_TIREUR' && answerBeatMs > 0) {
          await wait(Math.max(0, answerBeatMs - (Date.now() - startedAt)));
        }
        if (mounted.current && isFresh(seq)) {
          accept(next, calledName);
          setError(null);
          setNetworkDown(false);
        }
      } catch (caught) {
        if (mounted.current) setError(toDsaError(caught));
        // The server is the source of truth: re-read rather than guess.
        refreshAfterAction.current = false;
        await load(false);
      } finally {
        inFlight.current = false;
        if (mounted.current) {
          setBusy(false);
          setOutgoing(null);
        }
        if (refreshAfterAction.current) {
          refreshAfterAction.current = false;
          void load(true);
        }
      }
    },
    [accept, answerBeatMs, load, sessionId],
  );

  // --- keeping a room in sync -----------------------------------------------------
  // Only rooms need it: LOCAL and the AI modes change only through this device.
  const isRoom =
    state?.mode === 'HUMAN_VS_HUMAN' && (state.status === 'WAITING' || state.status === 'READY' || state.status === 'PLAYING');

  // A service without push (none ships today) is polled.
  useEffect(() => {
    if (!sessionId || !isRoom || service.supportsRealtime) return;
    const timer = setInterval(pushRefresh, FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [isRoom, pushRefresh, service, sessionId]);

  // Realtime: the subscription debounces events and polls while it is not subscribed.
  useEffect(() => {
    if (!sessionId || !isRoom || !service.supportsRealtime || !service.subscribe) {
      setRealtimeStatus(null);
      return;
    }
    return service.subscribe(sessionId, pushRefresh, (status) => {
      if (mounted.current) setRealtimeStatus(status);
    });
  }, [isRoom, pushRefresh, resubscribeTick, service, sessionId]);

  // Back to the foreground: sockets may have been dropped while in the background.
  useEffect(() => {
    if (!isRoom) return;
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (previous !== 'active' && next === 'active') {
        setResubscribeTick((tick) => tick + 1);
        pushRefresh();
      }
      previous = next;
    });
    return () => subscription.remove();
  }, [isRoom, pushRefresh]);

  // "Connexion perdue": the channel has not been subscribed for a while.
  useEffect(() => {
    if (!isRoom || realtimeStatus === null || realtimeStatus === 'SUBSCRIBED') {
      setChannelDown(false);
      return;
    }
    const timer = setTimeout(() => setChannelDown(true), lostAfterMs);
    return () => clearTimeout(timer);
  }, [isRoom, lostAfterMs, realtimeStatus]);

  // --- AI Découvreur -----------------------------------------------------------
  useEffect(() => {
    if (!sessionId || !state) return;
    if (state.mode !== 'AI_DECOUVREUR' || state.status !== 'PLAYING' || state.awaiting !== 'QUESTION') {
      setAiThinking(false);
      return;
    }
    if (busy || aiSteps.current >= MAX_AI_STEPS_IN_A_ROW) return;

    setAiThinking(true);
    const timer = setTimeout(() => {
      aiSteps.current += 1;
      void run((id) => service.aiDecouvreurStep(id), false).finally(() => {
        if (mounted.current) setAiThinking(false);
      });
    }, thinkingMs);

    return () => {
      clearTimeout(timer);
      setAiThinking(false);
    };
  }, [busy, run, service, sessionId, state, thinkingMs]);

  const myRoles = useMemo<Role[]>(
    () => (state?.players ?? []).filter((player) => player.is_me).map((player) => player.role),
    [state],
  );

  const exchanges = useMemo(() => buildExchanges(state?.path ?? [], guesses), [guesses, state?.path]);

  let phase: TablePhase | null = null;
  if (state) {
    if (state.status === 'WAITING' || state.status === 'READY') phase = 'LOBBY';
    else if (state.status !== 'PLAYING') phase = 'ENDED';
    else if (state.mode === 'LOCAL') {
      // A LOCAL game that already has answers (a reload mid-game) is past the hand-over.
      const pastHandOver = tireurReady || state.path.length > 0 || state.awaiting !== 'QUESTION';
      phase = pastHandOver ? 'PLAYING' : 'TIREUR_READY';
    } else phase = state.tireur_ready ? 'PLAYING' : 'TIREUR_READY';
  }

  const isLocal = state?.mode === 'LOCAL';
  const confirmTireurReady = useCallback(() => {
    if (isLocal) {
      if (sessionId) tireurReadySessions.add(sessionId);
      setTireurReady(true);
      return;
    }
    void run((id) => service.tireurReady(id), true);
  }, [isLocal, run, service, sessionId]);

  return {
    state,
    loading,
    busy,
    error,
    clearError,
    myRoles,
    isLocal,
    activeRole: state ? roleFor(state.awaiting) : null,
    aiThinking,
    outgoing,
    refusedGuess,
    exchanges,
    phase,
    confirmTireurReady,
    isRoom,
    realtimeStatus: isRoom ? realtimeStatus : null,
    connectionLost: isRoom && (channelDown || networkDown),
    refresh,
    ask: useCallback(
      () =>
        run((id) => service.ask(id), true, null, {
          kind: 'ASK',
          text: latest.current?.prompt?.text ?? '',
        }),
      [run, service],
    ),
    answer: useCallback(
      (answerLabel: string) => run((id) => service.answer(id, answerLabel), true),
      [run, service],
    ),
    guess: useCallback(
      (name: string) => run((id) => service.guess(id, name), true, name, { kind: 'GUESS', name }),
      [run, service],
    ),
    confirmGuess: useCallback(
      (answerLabel: 'OUI' | 'NON') => run((id) => service.confirmGuess(id, answerLabel), true),
      [run, service],
    ),
    goBack: useCallback((stepIndex: number) => run((id) => service.goBack(id, stepIndex), true), [run, service]),
    rewind: useCallback((count: 1 | 2 | 3) => run((id) => service.rewind(id, count), true), [run, service]),
    abandon: useCallback(() => run((id) => service.abandon(id), true), [run, service]),
  };
}
