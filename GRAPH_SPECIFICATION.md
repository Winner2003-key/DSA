# GRAPH SPECIFICATION — DSA

This document is the **contract** shared by every part of the project: database, core engine, importer, admin, mobile and web. If code disagrees with this document, fix one or the other explicitly and record the change in the session report.

Read GAME_RULES.md first; this spec implements it.

Language: **the UI is French only.** Code, identifiers and docs are in English. Book labels keep the book's exact spelling (the owner confirms there are no spelling errors in the book).

---

## 1. Platform architecture and constraints

npm workspaces monorepo:

```
apps/
  mobile/        Expo (Expo Router) for Android, iOS and web. The gameplay app, in French.
  admin/         Next.js + @xyflow/react. Web-only admin: graph editor and import review. French UI.
packages/
  core/          Pure TypeScript with no React, React Native or DOM dependencies: types, GraphIndex,
                 GameEngine, rules, intent matcher, validator, book transcription parser. Vitest tests.
supabase/
  migrations/    Ordered SQL (for a future `supabase db push`)
  sql-editor/    Files the owner pastes into the hosted Supabase dashboard SQL Editor, in numbered order
data/book/       Hand transcription of the source book (private: the folder and the PDF are never in the repo)
scripts/         import-book, validate-graph (run with tsx; they use packages/core and the service role key)
docs/sessions/   Work-session briefs and their reports
```

Constraints from the owner:
- **No Docker and no local Supabase stack.** SQL is delivered as files and run by hand in the dashboard. Nothing may run `supabase start`, `db reset` or `test db`.
- **Hosting on Vercel:**
  - `apps/mobile` web build (`npx expo export -p web`, output `dist/`);
  - `apps/admin` (Next.js).
- **Mobile:** tested with **Expo Go**. APKs are built with `eas build -p android --profile preview`.
- **Environment variables:** `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `SUPABASE_SERVICE_ROLE_KEY` is for local scripts only and never goes into a client or Vercel.

Voice capability matrix (detect at runtime and degrade gracefully):

| Capability | Web | Expo Go | EAS build (APK) |
|---|---|---|---|
| Text-to-speech | `speechSynthesis` | `expo-speech` ✅ | `expo-speech` ✅ |
| Speech-to-text | recorded audio → Edge Function `transcribe` ✅ | `expo-audio` recording → Edge Function `transcribe` ✅ | same ✅ |
| Human-to-human voice | `RTCPeerConnection` | ❌, falls back to game without voice | `react-native-webrtc` ✅ |

### Speech-to-text service (owner decision: a free hosted model)

- Supabase Edge Function `transcribe`:
  - input: an audio file of at most 30 s (multipart), plus an optional `hint` (the current prompt text and a few expected words);
  - output: `{ text, provider, duration_ms }`.
- It requires a signed-in Supabase JWT, so anonymous players are fine, and it applies a simple per-user rate limit.
- **Primary provider:** Groq, `whisper-large-v3-turbo` (OpenAI-compatible `POST https://api.groq.com/openai/v1/audio/transcriptions`, `language=fr`, `prompt=hint` to help with Bible names). It has a free tier with rate limits.
- **Fallback provider:** Hugging Face Inference Providers, `openai/whisper-large-v3`.
- API keys are **Edge Function secrets only**: `GROQ_API_KEY`, `HF_TOKEN`. They never appear in the repo, the app or Vercel.
- The function can be created in the dashboard (Edge Functions → Deploy a new function → editor) or deployed with `npx supabase functions deploy transcribe --use-api`, which needs no Docker.
- The client talks to a `SpeechToText` interface (`transcribe(audio, hint)`). The provider is swappable, and the Web Speech API stays available as an optional browser shortcut.
- Text-to-speech stays on-device (expo-speech / speechSynthesis) and needs no key.

### Recognising the Tireur's answers (owner decision, 2026-09-16)

**Transcribed text can't tell `OUI` from `OUIOUIOUI`.** Whisper normalizes a held "ouiiii" to "Oui". In this community the code is spoken as **one long sound**, not as a repeated word. So the Tireur's answers are classified from the **sound**, not from the text.

`AnswerAudioClassifier` in `apps/mobile/src/speech/`:

- **Input:** the loudness envelope captured during recording (expo-audio/expo-av metering on native, which works in Expo Go; Web Audio on the web). No audio decoding, no network call, no key.
- **Signal 1 (primary): length of the voiced sound.** A plain "oui" lasts about 0.2–0.4 s; a held "ouiiii" lasts 0.7 s or more.
- **Signal 2 (secondary): number of voiced bursts.** Two or more bursts of the same word also mean the repeated code, for players who repeat instead of stretching.
- **Calibration, once per person, stored locally:** "Dis OUI", then "Dis OUI très long". The two samples set that person's threshold (default: halfway between, with a floor of 0.55 s). It can be redone from the settings.
- **The transcription is only backup evidence:** number of `oui`/`non` tokens, and spellings like "ouiii" or "ouais ouais". Groq can also return per-word timings (`response_format=verbose_json`, `timestamp_granularities=["word"]`).
- **This only matters where the prompt allows both forms**, which is the spine questions (HOMME, PENTATEUQUE, LIVRE DE SAMUEL, LES ROIS). When `prompt.answer_classes` has no repeated class, a plain OUI/NON decision is enough and the classifier is skipped.
- **When it's borderline** (within ±15 % of the threshold), don't guess: show two large buttons ("OUI" / "OUI OUI OUI") for one tap. A wrong branch is far worse than one extra tap.
- **The answer buttons are always available**, so the game is fully playable without a microphone (and in Expo Go before S7 lands).

## 2. Graph model

### Node types
`START | QUESTION | CATEGORY | GROUP | CHARACTER | REFERENCE | END`

| Type | Meaning |
|---|---|
| `START` | Node "DSA". One `SYSTEM` edge (`DÉBUT`) to ANCIEN, followed automatically. |
| `QUESTION` | A spine question (ANCIEN, HOMME, PENTATEUQUE, LIVRE DE SAMUEL, LES ROIS, EVANGILES, …). Its outgoing edges are `DECISION` edges carrying answer codes. |
| `CATEGORY` | A section or sub-section (LIÉ À DAVID, SA FAMILLE, NÉS À HÉBRON, …). Ordered `HIERARCHY` children. |
| `GROUP` | Same behaviour as CATEGORY. `metadata.group_kind` ∈ `CLASSE \| TOME \| ALIAS \| OTHER` is **display-only**. **TOME and CLASSE are real questions**, asked in book order. |
| `CHARACTER` | A leaf. `label` = the NAME as printed; `question` = the clue (for example "Le révolté"); `metadata.qualifier` for alias leaves ("plus connu", …). |
| `REFERENCE` | "Continued on page X", resolved by the importer; none remain in a published graph. |
| `END` | Reserved, unused by the book. CHARACTER nodes are the terminals. |

### Edge kinds
`DECISION | HIERARCHY | SYSTEM` (column `graph_edges.edge_kind`). `order_index` is **the book's order**, and it is significant.

### Answer codes
Store the canonical label as printed on p2 (`OUI`, `NON`, `OUIOUIOUI`, `NONONONON`, `JE NE SAIS PAS`). Other pages' spellings go in `metadata.source_variants`. Comparison always goes through
`answerClass(label): 'OUI' | 'NON' | 'OUI_REPETE' | 'NON_REPETE' | 'JE_NE_SAIS_PAS' | 'AUTRE'`:

- the word OUI occurring ≥2 times (with or without spaces) → `OUI_REPETE`;
- NON occurring ≥2 times → `NON_REPETE`;
- **the repetition count is never significant.**

### Traversal rules (the single source of rules: `packages/core/src/rules.ts` and its SQL mirror)

A game position is derived by **replaying the list of answered steps** from START:

- **At a QUESTION node.** The prompt is the node's own label ("PENTATEUQUE ?"). The allowed answers are the classes of its outgoing DECISION edges. The answer moves to that edge's target.
- **At a CATEGORY or GROUP node with child cursor c.** The prompt is the child at `order_index` position c: its label, or its `question` (clue) for a CHARACTER child.
  - Allowed answers are `OUI` / `NON`.
  - `OUI` moves into the child, with cursor 0.
  - `NON` moves the cursor to c+1.
- **At a CHARACTER node** (reached by OUI on its clue), there is no further question. The Découvreur must call the name.
- **Dead end.** When the cursor goes past the last child, there is no prompt; the Découvreur must go back.
- **Call a name at any time** (`GUESS name`):
  - the Tireur confirms with OUI or NON;
  - OUI ends the game (DISCOVERED);
  - NON leaves the position unchanged.
  
  The correct confirmation is `normalize(name) === normalize(secret.label)`. Normalization is case-insensitive and ignores accents, hyphens and spaces. Aliases do **not** count, because the card shows one exact name.
- **Découvreur goes back to step k:** the answered steps are truncated to their first k entries, and the position is re-derived. That question is asked again.
- **Tireur says "QUESTION" ×N (N = 1..3):** the pair goes back to the question that **opened the list they are in**, N lists up (GAME_RULES §4). A step **enters a level** when it is a SPINE answer (a DECISION edge always moves) or a child prompt answered `OUI`; a child prompt answered `NON` does **not**, since it only advances the cursor. The N-th most recent entering step is found, that step and every step after it are undone, and its own question becomes the prompt again. With fewer than N entering steps the pair goes back to the very first question (step 0) — not an error. `INVALID_REWIND` is raised only for N outside 1..3 or an empty path.
  - The single definition lives in `packages/core/src/rules.ts` (`entersLevel`, `enteringStepIndices`, `rewindTarget`), mirrored in SQL by `dsa_replay` / `dsa_rewind_target`.
- **Correct answer, used by the AI Tireur and for statistics:**
  - at a QUESTION node, the class of the outgoing edge whose target is an ancestor-or-self of the secret;
  - for a child prompt, `OUI` if the child is an ancestor-or-self of the secret, otherwise `NON`.
- **Human Tireur answers are not forced to be correct** (GAME_RULES §5). They must only be one of the allowed answer classes.

Only nodes and edges with `review_status = 'APPROVED'` are playable. Secret candidates are CHARACTER nodes reachable from START through approved edges.

### Practising one part of the book (scope)

`game_sessions.settings.scope` is an array of **section node ids**: any approved non-CHARACTER node reachable from START (the spine questions ANCIEN, HOMME… are sections too). Absent or empty means the whole book.

- A scope restricts **only which name is drawn**. The traversal is untouched: the questions still start at the first one, so the pair walks the whole book down to that part and keeps learning the path. The end screen's book path (§9) shows it.
- The secret is drawn among the playable CHARACTER nodes **underneath** the chosen sections (their union, deduplicated). `dsa_redraw_secret` stays inside it, and `dsa_rematch` keeps it.
- Validation (`dsa_normalize_settings`): every id must be a section of that graph, and the union must hold at least one playable name — otherwise `DSA_INVALID_SETTINGS`, or `DSA_NO_PLAYABLE_SECRET` when the union is empty.
- `dsa_list_sections(p_graph_slug)` feeds the picker: `node_id`, `label`, `parent_id`, `depth` and `characters` (names underneath), in book order. It returns **no name, no clue and no leaf** — no more than the book's table of contents. Granted to `authenticated`.
- The single definition lives in `packages/core/src/scope.ts` (`listSections`, `scopeCharacters`, `checkScope`), mirrored in SQL by `dsa_sections` / `dsa_scope_characters`.

### Character card description
- `bible_characters.description` is generated at import as `"<clue> · <nearest CATEGORY label>"`, for example `"Le révolté · NÉS À HÉBRON"`, and admins can edit it.
- The Tireur's card shows the NAME in large type and the description in small type.

### Stable keys and IDs
- `node_key` is a path of slugs from the root, unique per graph.
  - Slug = lowercase ASCII, accents stripped (Œ→oe), non-alphanumeric characters → `-`, runs of dashes collapsed and trimmed.
  - The spine root question is `ancien` (START is `dsa`).
  - A spine child is `parentKey + '[' + answerSlug + ']/' + slug(childLabel)`. `answerSlug`: `OUI→oui`, `NON→non`, `OUI_REPETE→ouioui`, `NON_REPETE→nonnon`, `JE_NE_SAIS_PAS→je-ne-sais-pas`, otherwise `slug(label)`.
  - A tree child is `parentKey + '/' + slug(label)`; a CHARACTER child is `parentKey + '/' + slug(clue) + '--' + slug(name)` (just `slug(name)` if there's no clue). A collision between siblings gets `~2`, `~3` appended.
  - An explicit `{key: …}` tag overrides the generated key.
- `id` = UUID v5(namespace `6f1f3f7e-0d7b-4f6c-9d7e-5a0c2b1d4e9a`, `graphSlug + ':' + node_key`).
- Edge `id` = UUID v5(same namespace, `graphSlug + ':' + fromKey + '->' + toKey`).
- The import is idempotent: rows are upserted on `id`.

## 3. Database

The brief's tables are all present. Additions:

| Addition | Purpose |
|---|---|
| `graphs.slug` unique, `graphs.status` (`DRAFT`/`PUBLISHED`) | import identity |
| `graph_nodes.node_key` (unique with graph_id), `review_status` (`DRAFT`/`NEEDS_REVIEW`/`APPROVED`/`REJECTED`), `review_note` | idempotency and review |
| `graph_edges.edge_kind`, `review_status`, `review_note` | model and review |
| `bible_characters.aliases TEXT[]`, `metadata JSONB` | alias names |
| `game_sessions.mode`, `awaiting` (`QUESTION`/`ANSWER`/`GUESS_CONFIRM`/`NONE`), `current_node_id`, `child_cursor INT`, `pending_prompt_node_id`, `pending_guess TEXT` | game state |
| `game_moves.move_type` ∈ `QUESTION`/`ANSWER`/`GUESS`/`GUESS_CONFIRM`/`BACK`/`REWIND`/`SYSTEM`, plus `step_index INT`, `payload JSONB`, `is_undone BOOL DEFAULT FALSE` | full history; undone steps are kept but flagged |
| **`game_secrets(game_session_id PK, secret_node_id, secret_character_id)`** | The secret is never stored in `game_sessions`. RLS: SELECT only for that session's TIREUR. Not in the realtime publication. |
| `admin_users(user_id PK)` and `dsa_is_admin()` | admin role |
| `import_batches` | import review |

### RPCs (SECURITY DEFINER, `set search_path = public`, check `auth.uid()` and role)

| Function | Caller | Effect |
|---|---|---|
| `dsa_create_session(p_graph_slug, p_mode, p_role, p_display_name)` → `(session_id, room_code)` | any signed-in user (anonymous allowed) | room code `DSA-####`. Picks a random playable secret. In LOCAL mode the caller holds both roles. |
| `dsa_join_session(p_room_code, p_display_name)` → `(session_id, role)` | any | takes the free role |
| `dsa_get_my_secret(p_session_id)` → `(node_id, name, description)` | TIREUR only | raises an error otherwise |
| `dsa_get_state(p_session_id)` → JSON | players | `{status, mode, awaiting, prompt: {node_id, text, node_type, answer_classes} \| null, dead_end, pending_guess, path: [{step_index, node_id, text, answer_label}], players}`. **Only the current prompt and the traversed path; never future nodes and never the secret.** |
| `dsa_ask(p_session_id)` | DÉCOUVREUR | asks the current prompt. In AI_TIREUR mode the answer is inserted immediately. |
| `dsa_answer(p_session_id, p_answer_label)` | TIREUR | the label's class must be allowed for the prompt. Records the step and re-derives the position. |
| `dsa_guess(p_session_id, p_name)` | DÉCOUVREUR | sets `pending_guess`. AI_TIREUR mode confirms automatically. |
| `dsa_confirm_guess(p_session_id, p_answer_label)` | TIREUR | OUI → `DISCOVERED`, `winner = 'DECOUVREUR'` |
| `dsa_go_back(p_session_id, p_step_index)` | DÉCOUVREUR | truncates to that step (marks later steps `is_undone`) |
| `dsa_rewind(p_session_id, p_count)` | TIREUR | the "QUESTION ×N" rule, count 1–3 |
| `dsa_ai_decouvreur_step(p_session_id)` | TIREUR in AI_DECOUVREUR mode | the server plays the Découvreur's next action |
| `dsa_abandon(p_session_id)` | player | `ABANDONED` |
| `dsa_get_revealed_path(p_session_id)` | players | traversed, non-undone steps. After DISCOVERED/ABANDONED it also returns the secret name and description. |
| `dsa_list_names(p_graph_slug)` → `text[]` | any | distinct character names and aliases, **no structure**, used by the client to recognise spoken name calls |
| `dsa_compute_answer(...)` | internal only | not granted to anon or authenticated |

Clients never read `game_secrets` or the graph tables directly during play. Graph tables are admin-only.

### Realtime
- Publication: `game_sessions`, `game_players`, `game_moves`; **never `game_secrets`**. Clients react to a change by calling `dsa_get_state`.
- WebRTC signaling uses the Realtime **broadcast** channel `room:<ROOM_CODE>` with events `offer`/`answer`/`ice`/`hangup`.

## 4. packages/core public API

```ts
export type NodeType = 'START'|'QUESTION'|'CATEGORY'|'GROUP'|'CHARACTER'|'REFERENCE'|'END';
export type EdgeKind = 'DECISION'|'HIERARCHY'|'SYSTEM';
export type ReviewStatus = 'DRAFT'|'NEEDS_REVIEW'|'APPROVED'|'REJECTED';
export type GroupKind = 'CLASSE'|'TOME'|'ALIAS'|'OTHER';
export type AnswerClass = 'OUI'|'NON'|'OUI_REPETE'|'NON_REPETE'|'JE_NE_SAIS_PAS'|'AUTRE';
export type GameMode = 'HUMAN_VS_HUMAN'|'AI_TIREUR'|'AI_DECOUVREUR'|'LOCAL';
export type Role = 'TIREUR'|'DECOUVREUR';
export type SessionStatus = 'WAITING'|'READY'|'PLAYING'|'DISCOVERED'|'ABANDONED';
export type Awaiting = 'QUESTION'|'ANSWER'|'GUESS_CONFIRM'|'NONE';

export interface Graph { id; slug; name; description: string|null; version: number; isActive: boolean; status: 'DRAFT'|'PUBLISHED'; sourceDocument: string|null }
export interface GraphNode { id; graphId; nodeKey; nodeType: NodeType; label: string; question: string|null; description: string|null; characterId: string|null; sourcePage: number|null; positionX: number|null; positionY: number|null; reviewStatus: ReviewStatus; reviewNote: string|null; metadata: NodeMetadata }
export interface NodeMetadata { printed_page?: number; extra_pages?: number[]; group_kind?: GroupKind; qualifier?: string; target_node_key?: string; notes?: string[]; variants?: string[]; [k: string]: unknown }
export interface GraphEdge { id; graphId; fromNodeId; toNodeId; answerLabel: string; edgeKind: EdgeKind; orderIndex: number; sourcePage: number|null; reviewStatus: ReviewStatus; reviewNote: string|null; metadata: { source_variants?: {label: string; page: number}[]; [k: string]: unknown } }
export interface BibleCharacter { id; name: string; nameFr: string|null; nameEn: string|null; gender: 'M'|'F'|null; testament: 'ANCIEN'|'NOUVEAU'|null; description: string|null; aliases: string[]; isActive: boolean; metadata: Record<string, unknown> }
export interface GraphData { graph: Graph; nodes: GraphNode[]; edges: GraphEdge[]; characters: BibleCharacter[] }

export function answerClass(label: string): AnswerClass;
export class GraphIndex { constructor(data: GraphData, opts?: { approvedOnly?: boolean }); node(id); start(); outgoing(id): GraphEdge[] /* sorted by orderIndex */; parentEdge(id); isAncestorOrSelf(a, b): boolean; playableCharacters(): GraphNode[]; characterOf(nodeId): BibleCharacter|null }

export interface Step { index: number; promptNodeId: string; answerLabel: string }  // answered steps only
export interface Position { nodeId: string; childCursor: number }
export interface Prompt { promptNodeId: string; atNodeId: string; text: string; kind: 'SPINE'|'CHILD'; answerClasses: AnswerClass[] }
export function derivePosition(ix: GraphIndex, steps: Step[]): Position;
export function currentPrompt(ix: GraphIndex, pos: Position): Prompt | null;   // null = dead end or CHARACTER reached
export function correctAnswer(ix: GraphIndex, prompt: Prompt, secretNodeId: string): AnswerClass;
export function isCorrectName(ix: GraphIndex, name: string, secretNodeId: string): boolean;

export interface EngineState { status: SessionStatus; awaiting: Awaiting; steps: Step[]; undoneSteps: Step[]; pendingGuess: string|null; moves: EngineMove[]; secretNodeId: string|null; startedAt: string; endedAt: string|null }
export class GameEngine {
  constructor(ix: GraphIndex, opts?: { rng?: () => number; now?: () => string });
  newGame(secretNodeId?: string): EngineState;
  ask(s: EngineState): EngineState;
  answer(s: EngineState, label: string): EngineState;
  guess(s: EngineState, name: string): EngineState;
  confirmGuess(s: EngineState, label: 'OUI'|'NON'): EngineState;
  goBack(s: EngineState, stepIndex: number): EngineState;
  rewind(s: EngineState, count: 1|2|3): EngineState;
  aiDecouvreurAction(s: EngineState): { type: 'ASK' } | { type: 'GUESS'; name: string } | { type: 'BACK'; stepIndex: number };
  aiTireurAnswer(s: EngineState): string;
  revealedPath(s: EngineState): PathStep[];
  stats(s: EngineState): GameStats;
}

// Voice or text intent (French). No LLM.
export type Intent =
  | { type: 'ASK'; confidence: number }                 // utterance matches the current prompt
  | { type: 'GUESS'; name: string; confidence: number } // utterance names a known name ("C'est David !")
  | { type: 'BACK'; stepIndex?: number }                // "revenir", "retour", "question précédente"
  | { type: 'ANSWER'; label: string }                   // "oui", "oui oui", "non non non", "je ne sais pas"
  | { type: 'REWIND'; count: 1|2|3 }                    // "question", "question question", …
  | { type: 'UNKNOWN' };                                // "Je n'ai pas bien compris. Peux-tu répéter ?"
export function matchIntent(utterance: string, ctx: { role: Role; prompt: Prompt|null; answerLabels: string[]; knownNames: string[]; path: {index: number; text: string}[] }): Intent;

export function validateGraph(data: GraphData): ValidationReport;
export function parseSpine(text: string, fileName: string): ParsedSpine;
export function parsePage(text: string, fileName: string): ParsedPage;
export function buildGraphData(graphSlug: string, spine: ParsedSpine, pages: ParsedPage[], opts?: { defaultReviewStatus?: ReviewStatus }): { data: GraphData; report: BuildReport };
```

The TypeScript and SQL implementations of the rules must pass the same scenarios (docs/sessions/mini-graph-fixture.md).

## 5. Book transcription format (`data/book/`)

UTF-8, 2-space indentation, `#` starts a comment. Tags `{name: value}` or `{flag}` may appear several times on a line.

**`spine.dsa`**

```
START DSA
  DÉBUT -> QUESTION ANCIEN @p2
    OUI -> QUESTION HOMME @p2 @p5
      NONONONON {variants: NONONONO@27} -> QUESTION LIVRE DE SAMUEL @p2 @p27
```

- Each line is `ANSWER [tags] -> TYPE LABEL [tags] @pNN…`.
- The edge is DECISION, except `DÉBUT` under START, which is SYSTEM.
- Order of lines = `order_index`.

**`pages/pNNN.dsa`**

```
@page 23
@printed 22
@attach ancien[oui]/homme[oui]/pentateuque[non]/les-3-premiers

LIVRE DE JOSUE {variant: I.LIVRE DE JOSUE}
  CLASSE DE JOSUE {variant: 1 CLASSE DE JOSUE}
    Serviteur de MOÏSE {alias}
      plus connu • JOSUE
```

- Every top-level line is a child of `@attach`. A node may receive children from several pages.
- `clue • NAME` → CHARACTER, always normalized to clue first. A line without `•` → CATEGORY, or GROUP when tagged.
- Section numbering is removed from labels and kept as `{variant: …}`.
- Tags:
  - `{classe}`, `{tome}`, `{alias}`: group kinds;
  - `{review: text}`: NEEDS_REVIEW;
  - `{note: text}`: `metadata.notes`;
  - `{variant: text}`: a printed form;
  - `{key: node_key}`: overrides the generated key;
  - `{same-as: node_key}`: same person as another node, sharing one character row.

## 6. Reveal rules (UI)

- During play the Découvreur's screen shows only the traversed path (from `dsa_get_state`) and the current prompt. Future and eliminated branches are never rendered.
- On DISCOVERED the animated path `QUESTION → answer → … → NAME ⭐` is shown. It can be zoomed and panned, and scrolls on mobile.

## 7. Wave-1 decisions (2026-09-15; these amend the sections above)

The implementations in `docs/sessions/reports/S1-core.md` and `S2-database.md` are accepted. Where they differ from the sections above, **they are the contract**. In particular:

- **`order_index`** is 0-based per parent, in book order.
- **Graph id** = v5(`graphSlug`). **Character id** = v5(`graphSlug + ':character:' + primaryNodeKey`), where the primary node is the first alias child or the `{same-as}` target.
- **Salted ids for real graphs (security).**
  - Deterministic ids plus the public key rules would let a Découvreur hash a clue together with each name and find the leaf.
  - For every graph except the test graph `mini`, node, edge and character ids are therefore built from `graphSlug + ':' + DSA_ID_SALT + ':' + key`.
  - `DSA_ID_SALT` is a private, constant value kept only in the importer's local `.env` (never in the repo, the app or Vercel).
  - Admin-created nodes use random v4 UUIDs.
- **Character description** = `"<clue> · <nearest CATEGORY>"`, skipping GROUP ancestors. For ALIAS groups the clue is the group label.
- **Engine and RPC state machine:**
  - A name call is only possible while `awaiting = QUESTION` (including at dead ends and on a reached CHARACTER).
  - `go_back` and `rewind` are allowed while awaiting QUESTION or ANSWER (an unanswered question is dropped), but not during GUESS_CONFIRM.
  - `READY` is not used.
- **Every mutating RPC returns the new state JSON.** Errors are `DSA_<CODE>: …`; the full list is in DATABASE_SCHEMA.md.
- **Recorded answers:** ANSWER moves store the book's canonical label, and the spoken form goes in `payload.spoken_label`.
- **AI players** have `game_players` rows (`is_ai = true`, display name `IA`).
- **Room codes** `DSA-####` are unique among open sessions only.
- **Never send `EngineState.moves` or `secretNodeId` to a Découvreur client.** Core ANSWER moves carry `expectedClass`, which is derived from the secret.
- **Validator:** an APPROVED DECISION edge whose label class is `AUTRE` is an error.
- **Clients always send a canonical answer label** to `dsa_answer` (`OUI`, `NON`, `OUIOUIOUI`, `NONONONON`, `JE NE SAIS PAS`), taken from `prompt.answer_classes`. Never send raw speech: `dsa_answer_class('ouiii')` is `OUI`, not `OUI_REPETE`, so a raw transcript would silently pick the wrong branch. The spoken form is kept only for the record (`payload.spoken_label`).

## 8. Game UX iteration (owner feedback, 2026-09-16; implemented by S3b)

- **Card description:** shown to the Tireur (and on the result screen) **only when another person in the graph has the same name**.
  - `dsa_get_my_secret` and `dsa_get_revealed_path().secret` return `has_homonyms`.
  - Homonyms = same normalized label, **different** character (aliases of one person don't count).
- **Path entries** (`dsa_get_state.path[]`, `dsa_get_revealed_path.path[]`) gain `prompt_kind` (`SPINE`|`CHILD`), `node_type` and `target_text` (for SPINE steps, the section entered by the answer).
- **`dsa_get_revealed_path`** gains `stats: {questions, non, backs, rewinds}`.
- **The end-of-game path is drawn as a graph, like the book:**
  - an entering answer goes down;
  - a NON on a list moves right to the next sibling;
  - entered sections are boxes;
  - answer tags use the book's page-2 colours (OUI green, NON amber, OUIOUIOUI/NONONONON red, JE NE SAIS PAS blue), always with text.
- **The Découvreur screen is a conversation:** each question is paired with its own answer, and the next question is a separate "À toi" card.
- **Session settings:** `game_sessions.settings jsonb`, set through `dsa_create_session(…, p_settings)`.
  - `input_mode` ∈ `VOICE|BUTTONS` (default `BUTTONS`), chosen by the room creator (or the solo/LOCAL player). VOICE stays disabled until S7.
  - The key is reserved for the timer values of §9.
- **LOCAL mode starts with the Tireur:** the card is shown first, then the phone is passed to the Découvreur.

## 10. Voice and phrasing rules (owner, 2026-09-16)

- **Direct questions.**
  - A prompt is shown and spoken as its **book label plus "?"**, with no "Est-ce": `ANCIEN ?`, `HOMME ?`, `LIE A DAVID ?`, and the clue for a CHARACTER child (`Le meurtrier ?`).
  - This applies to the prompt card, the conversation bubbles, the Tireur's "incoming question" and every TTS utterance (the AI Découvreur asks "Ancien ?").
  - The intent matcher treats the bare label as the normal ASK. Longer phrasings ("est-ce que c'est dans le Pentateuque") are still accepted.
- **Speech pronunciation.** Book labels are stored in capitals without accents ("LIE A ADAM", "EVANGILES"). TTS speaks a **speakable form** from a French lexicon (`packages/voice`: "LIE A" → "lié à", "EVANGILES" → "Évangiles", "MOISE" → "Moïse", …). The screen always shows the book spelling.
- **Spoken answers** (AI Tireur and echoes): OUI → "Oui.", NON → "Non.", the repeated codes → a clearly **held** sound ("Ouiiii !" / "Nonnnn !"), JE NE SAIS PAS → "Je ne sais pas."
- **Credentials:**
  - Groq / Hugging Face keys are Supabase Edge Function secrets only (§1);
  - TURN server credentials (S7c) are issued short-lived by an Edge Function, never embedded in the app.

## 9. Timed games, name changes and the solution path (owner, 2026-09-16 / 2026-09-17; built by S9)

**Settings**
- `app_settings`: a single row, admin-editable (RLS), holding `think_seconds` (default 40, bounds 10–600), `play_seconds` (default 120, bounds 30–1800) and `max_redraws` (default 2, bounds 0–5).
- `game_sessions.settings` gains `timed` (boolean, default **false**), sent by the client through `dsa_create_session(p_settings)` (and `dsa_rematch` keeps it).
- When `timed` is true, the server **copies** `think_seconds` and `play_seconds` into `settings` at creation, so a running game never changes. `max_redraws` is always copied.
- Clients may only send `input_mode` and `timed`; any other key is still `DSA_INVALID_SETTINGS`.

**Clock (only when `settings.timed`); the server is authoritative**
- **Thinking phase:** starts when the Tireur has the card and both players are present; `think_ends_at = now() + think_seconds`. It ends at `think_ends_at` or at `dsa_tireur_ready` (early), whichever comes first.
- **Game phase:** `play_ends_at = <end of thinking> + play_seconds`.
- **Deadline check:** every mutating RPC checks the deadline first. After it, the session becomes **`TIME_UP`** (new status, `winner` null, both lose) and the call raises `DSA_TIME_UP`. `dsa_check_time(session)` lets idle clients trigger it.
- **State JSON:** adds `timed`, `phase` (`THINKING`|`PLAYING`), `think_ends_at`, `play_ends_at` and **`server_now`**. Clients display a countdown computed against `server_now`, never against the device clock.
- **Modes:** the AI Tireur has no thinking phase. A human Tireur facing the AI Découvreur does. LOCAL: the thinking phase replaces the client-only `TIREUR_READY` step. Untimed games keep the existing "Je suis prêt" behaviour with no clock.

**Preparation phase and name change (owner, 2026-09-17)**
- **Every mode with a human Tireur** (HUMAN_VS_HUMAN, LOCAL, AI_DECOUVREUR) starts in a server-side **preparation phase**: the Tireur sees the card, and nobody can ask, call a name or let the AI Découvreur play until the Tireur taps "Je suis prêt" (`dsa_tireur_ready`), or until the thinking time ends in a timed game.
  - This generalizes S6's HUMAN_VS_HUMAN `tireur_ready_at` to LOCAL and AI_DECOUVREUR, and replaces the client-only LOCAL `TIREUR_READY` step.
  - AI_TIREUR has no preparation phase.
- `dsa_redraw_secret(p_session_id)` (TIREUR only) draws a new random playable secret. It excludes every secret already drawn in this session (`game_secrets.previous_node_ids`, private).
  - It's **allowed only during the preparation phase**, before `tireur_ready_at` is set and before any question. Otherwise it raises `DSA_GAME_STARTED`.
  - After `max_redraws` it raises `DSA_NO_REDRAW_LEFT`.
  - In a timed game it **restarts the thinking time** (`think_ends_at = now() + think_seconds`).
- The state JSON exposes `redraws_used` and `redraws_left`, never which names were drawn. A `SYSTEM` move with `payload.event = 'REDRAW'` lets the other device show "Le Tireur a changé de nom".
- Once the game has started the name can't change; the Tireur can only abandon (`dsa_abandon`).
- **Time is fixed:** rewinds, going back and wrong name calls consume the same game time. Nothing extends or resets `play_ends_at` once it's set.

**End of every game: statistics and the book's path**
- `dsa_get_solution_path(p_session_id)`: players, **only once the session is `DISCOVERED`, `TIME_UP` or `ABANDONED`**.
  - It returns the **book's canonical path** from START to the secret: every spine question with its correct code; inside the trees, each child in book order answered NON until the one answered OUI; then the name.
  - It uses the same entry shape as `path[]` (`step_index`, `text`, `answer_label`, `prompt_kind`, `node_type`, `target_text`) plus the secret `{name, description, has_homonyms}`, so `PathGraph` renders it unchanged.
  - Core mirror: `solutionPath(ix, secretNodeId)`, which is exactly the AI Découvreur's walk with a truthful Tireur, without name calls.
- `dsa_get_revealed_path().stats` gains `timed`, `play_seconds` (the limit, when timed) and `found_in_seconds` (from the start of the game phase to the discovery; null unless `DISCOVERED`).
- **Result screen, for every outcome:**
  - first the game card: the outcome, the name (description only when homonyms exist), the stats (questions, NON, back-steps, rewinds) and, **if timed and discovered, "Trouvé en X sur Y"**;
  - then **"Le chemin du livre pour trouver <NOM>"**: the animated `PathGraph` of the **solution path**. The players' own path is **not** shown on the result screen.
- During play, "Voir le chemin" keeps showing the players' own traversed path.
