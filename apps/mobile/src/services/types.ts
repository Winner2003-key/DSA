import type { AnswerClass, Awaiting, GameMode, GamePhase, NodeType, Role, SessionStatus } from '@dsa/core';

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

/**
 * `game_sessions.settings`, chosen when the game is created (GRAPH_SPECIFICATION
 * §8 and §9). A client only ever sends `input_mode` and `timed`; the server adds
 * the durations and `max_redraws` from `app_settings`, so a running game keeps
 * them even when the admin changes the Réglages page.
 */
export interface GameSettings {
  input_mode: InputMode;
  /** "Jouer avec le chronomètre", unchecked by default. */
  timed: boolean;
  /** Seconds the Tireur gets to work out the path; only sent for a timed game. */
  think_seconds: number | null;
  play_seconds: number | null;
  /** How many times the Tireur may draw another name before the start. */
  max_redraws: number;
  /**
   * "Choisir une partie": the section node ids the drawn name must come from.
   * Empty is « Tout le livre ». It changes **only** which name is drawn — the
   * questions still start at ANCIEN, so the pair walks the whole book down to it.
   */
  scope: string[];
}

/** The three keys a client may choose. Everything else is the server's to fill in. */
export type ClientSettings = Pick<GameSettings, 'input_mode' | 'timed' | 'scope'>;

export const DEFAULT_SETTINGS: GameSettings = {
  input_mode: 'BUTTONS',
  timed: false,
  think_seconds: null,
  play_seconds: null,
  max_redraws: 2,
  scope: [],
};

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

  // --- the timer and the name change (GRAPH_SPECIFICATION §9) ---------------
  /** This game is played with the chronometer. */
  timed: boolean;
  /** `THINKING` while the Tireur has the card; `PLAYING` from the first question. */
  phase: GamePhase;
  /** End of the thinking time; null in an untimed game. */
  think_ends_at: string | null;
  /** End of the game time. Set when the thinking ends, and never moved again. */
  play_ends_at: string | null;
  /**
   * The server's own clock at the moment it answered. Countdowns are computed
   * against this, never against the device clock, so a phone whose time is wrong
   * (or that just reconnected) still shows the right seconds.
   */
  server_now: string;
  /** How many times the Tireur has already drawn another name. Never which ones. */
  redraws_used: number;
  redraws_left: number;
  /**
   * The names of the chosen sections, in book order ("LES EVANGILES"), so the
   * game screen can write « Partie : … » without a second call. Empty for the
   * whole book. Labels only: a section is never a name.
   */
  scope_labels: string[];
}

/** One line of `dsa_list_sections`: the picker's tree, with no name and no clue. */
export interface BookSection {
  node_id: string;
  label: string;
  parent_id: string | null;
  depth: number;
  /** How many playable names are underneath. */
  characters: number;
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
  /** §9: the game was played with the chronometer. */
  timed: boolean;
  /** The limit the players had, in seconds; null when the game was untimed. */
  play_seconds: number | null;
  /** From the start of the game phase to the discovery; null unless discovered. */
  found_in_seconds: number | null;
}

/**
 * `dsa_get_solution_path`: the book's own way to the name, available only once
 * the game is over. The entries have the same shape as a played `path[]`, so the
 * result screen renders it with the very same `PathGraph`.
 */
export interface SolutionPath {
  status: SessionStatus;
  path: PathEntry[];
  secret: Secret | null;
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

/** `dsa_timer_defaults`: what the chronometer would give a game started now. */
export interface TimerDefaults {
  think_seconds: number;
  play_seconds: number;
  max_redraws: number;
}

export const FALLBACK_TIMER_DEFAULTS: TimerDefaults = { think_seconds: 40, play_seconds: 120, max_redraws: 2 };

export interface CreateSessionOptions {
  graphSlug: string;
  mode: GameMode;
  /** HUMAN_VS_HUMAN only: the role the creator takes. */
  role?: Role;
  displayName?: string;
  /** `p_settings`. Omitted keys take the server defaults. */
  settings?: Partial<ClientSettings>;
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
