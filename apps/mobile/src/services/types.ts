import type { AnswerClass, Awaiting, GameMode, NodeType, Role, SessionStatus } from '@dsa/core';

/** `dsa_get_state().prompt` — the only thing a Découvreur ever learns about the graph. */
export interface StatePrompt {
  node_id: string;
  text: string;
  node_type: NodeType;
  answer_classes: AnswerClass[];
}

/** One answered step of the traversed path. Never contains future nodes. */
export interface PathEntry {
  step_index: number;
  node_id: string;
  text: string;
  answer_label: string;
  /** SPINE: a book question with answer codes. CHILD: an item of a section's list. */
  prompt_kind: 'SPINE' | 'CHILD';
  /** Type of the prompt node (GROUP = a TOME or CLASSE question). */
  node_type: NodeType;
  /** SPINE only: the text of the node the answer entered ("LIE A DAVID"); null for CHILD. */
  target_text: string | null;
}

/** How the players give their answers. VOICE stays disabled in the UI until S7. */
export type InputMode = 'VOICE' | 'BUTTONS';

/** `game_sessions.settings`, chosen when the game is created (GRAPH_SPECIFICATION §8). */
export interface GameSettings {
  input_mode: InputMode;
}

export const DEFAULT_SETTINGS: GameSettings = { input_mode: 'BUTTONS' };

export interface StatePlayer {
  role: Role;
  display_name: string | null;
  is_ai: boolean;
  is_me: boolean;
}

/** The exact shape returned by `dsa_get_state` and by every mutating RPC. */
export interface GameState {
  status: SessionStatus;
  mode: GameMode;
  awaiting: Awaiting;
  prompt: StatePrompt | null;
  dead_end: boolean;
  pending_guess: string | null;
  path: PathEntry[];
  players: StatePlayer[];
  settings: GameSettings;
  /**
   * False only while a room's Tireur is still looking at the card (`dsa_tireur_ready`
   * not called yet). Every other mode is ready from creation. The §9 thinking time
   * will run during exactly this phase.
   */
  tireur_ready: boolean;
  /** `DSA-1234`. The lobby shows it, and the room's Realtime channel is `room:<code>`. */
  room_code: string | null;
}

export interface Secret {
  node_id: string;
  name: string;
  description: string | null;
  /** Another person in the book has this name: only then is the description shown. */
  has_homonyms: boolean;
}

/** The description to show on a card, or null (GRAPH_SPECIFICATION §8). */
export function cardDescription(secret: Pick<Secret, 'description' | 'has_homonyms'>): string | null {
  return secret.has_homonyms && secret.description ? secret.description : null;
}

/** Counted by the server over every move, undone ones included. */
export interface GameStats {
  questions: number;
  non: number;
  backs: number;
  rewinds: number;
}

/** `dsa_get_revealed_path`. `secret` stays null until the game ends. */
export interface RevealedPath {
  status: SessionStatus;
  winner: Role | null;
  path: PathEntry[];
  /** null only from a server that predates 03_game_ux.sql; the UI then hides the stats. */
  stats: GameStats | null;
  secret: Secret | null;
}

export interface CreateSessionOptions {
  graphSlug: string;
  mode: GameMode;
  /** HUMAN_VS_HUMAN only: the role the creator takes. */
  role?: Role;
  displayName?: string;
  /** `p_settings`. Omitted keys take the server defaults. */
  settings?: Partial<GameSettings>;
}

export interface CreatedSession {
  sessionId: string;
  roomCode: string;
}

export interface JoinedSession {
  sessionId: string;
  role: Role;
}

/** `dsa_rematch`: the new room of "Rejouer", and this player's role in it. */
export interface RematchSession {
  sessionId: string;
  roomCode: string;
  role: Role;
}

/** Answer classes, as the canonical book labels the RPCs expect (GRAPH_SPECIFICATION §7). */
export const CANONICAL_LABEL: Record<AnswerClass, string> = {
  OUI: 'OUI',
  NON: 'NON',
  OUI_REPETE: 'OUIOUIOUI',
  NON_REPETE: 'NONONONON',
  JE_NE_SAIS_PAS: 'JE NE SAIS PAS',
  AUTRE: 'AUTRE',
};
