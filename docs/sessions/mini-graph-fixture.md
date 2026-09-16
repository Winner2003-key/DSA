# Mini graph fixture and shared rule scenarios

Both implementations of the game rules must pass every scenario below against this graph:
- TypeScript, in `packages/core` (`packages/core/fixtures/mini-graph.json`);
- SQL, in `supabase/sql-editor/01_seed_mini_graph.sql` and `90_tests.sql`.

- Graph slug `mini`, status `PUBLISHED`, everything `APPROVED`.
- IDs are UUID v5 with namespace `6f1f3f7e-0d7b-4f6c-9d7e-5a0c2b1d4e9a`.
  - Node name: `mini:<node_key>`.
  - Edge name: `mini:<from_key>-><to_key>`.
- Every edge from a CATEGORY or GROUP to a child is `HIERARCHY` with label `OUI`, and `order_index` follows the listing order below.

## Nodes (listed in book order under each parent)

Abbreviations: `P = ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes`, `S = ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel`, `E = ancien[non]/homme[oui]/les-evangiles`

| node_key | type | label | question |
|---|---|---|---|
| `dsa` | START | DSA | |
| `ancien` | QUESTION | ANCIEN | |
| `ancien[oui]/homme` | QUESTION | HOMME | |
| `ancien[oui]/homme[oui]/pentateuque` | QUESTION | PENTATEUQUE | |
| `P` | CATEGORY | PENTATEUQUE (HOMMES) | |
| `P/lie-a-adam` | CATEGORY | LIE A ADAM | |
| `P/lie-a-adam/classe-1` | GROUP (CLASSE) | CLASSE 1 | |
| `P/lie-a-adam/classe-1/premier-homme--adam` | CHARACTER | ADAM | Premier homme |
| `P/lie-a-adam/classe-1/le-meurtrier--cain` | CHARACTER | CAÏN | Le meurtrier |
| `P/lie-a-abraham` | CATEGORY | LIE A ABRAHAM | |
| `P/lie-a-abraham/pere-de-la-foi` | GROUP (ALIAS) | PÈRE DE LA FOI | |
| `P/lie-a-abraham/pere-de-la-foi/plus-connu--abraham` | CHARACTER | ABRAHAM | plus connu |
| `P/lie-a-abraham/pere-de-la-foi/moin-connu--abram` | CHARACTER | ABRAM | moin connu |
| `P/lie-a-abraham/tome-1` | GROUP (TOME) | TOME 1 | |
| `P/lie-a-abraham/tome-1/fils-d-agar--ismael` | CHARACTER | ISMAËL | FILS D'AGAR |
| `P/lie-a-abraham/tome-1/fils-de-la-promesse--isaac` | CHARACTER | ISAAC | FILS DE LA PROMESSE |
| `ancien[oui]/homme[oui]/pentateuque[non]/les-3-premiers` | CATEGORY | LES 3 PREMIERS | |
| `ancien[oui]/homme[oui]/pentateuque[non]/les-3-premiers/serviteur-de-moise--josue` | CHARACTER | JOSUE | Serviteur de MOÏSE |
| `S` | QUESTION | LIVRE DE SAMUEL | |
| `S[ouioui]/lie-a-david` | CATEGORY | LIE A DAVID | |
| `S[ouioui]/lie-a-david/fils-d-isai--david` | CHARACTER | DAVID | fils d'isaï |
| `S[non]/les-rois` | CATEGORY | LES ROIS | |
| `S[non]/les-rois/le-premier--jeroboam` | CHARACTER | JEROBOAM | LE PREMIER |
| `ancien[oui]/homme[je-ne-sais-pas]/les-3-derniers` | CATEGORY | LES 3 DERNIERS | |
| `ancien[oui]/homme[je-ne-sais-pas]/les-3-derniers/verse-dans-les-ecritures--esdras` | CHARACTER | ESDRAS | VERSÉ DANS LES ÉCRITURES |
| `ancien[non]/homme` | QUESTION | HOMME | |
| `E` | CATEGORY | LES EVANGILES | |
| `E/le-sauveur--jesus-christ` | CHARACTER | JESUS-CHRIST | le sauveur |
| `E/fils-d-alphee--jacques` | CHARACTER | JACQUES | Fils d'Alphée |
| `E/fils-de-zebedee--jacques` | CHARACTER | JACQUES | Fils de Zébédée |

## DECISION / SYSTEM edges (in order)

| from | to | kind | label |
|---|---|---|---|
| dsa | ancien | SYSTEM | DÉBUT |
| ancien | ancien[oui]/homme | DECISION | OUI |
| ancien | ancien[non]/homme | DECISION | NON |
| ancien[oui]/homme | ancien[oui]/homme[oui]/pentateuque | DECISION | OUI |
| ancien[oui]/homme | …/les-3-derniers | DECISION | JE NE SAIS PAS |
| …/pentateuque | P | DECISION | OUI |
| …/pentateuque | …/les-3-premiers | DECISION | NON |
| …/pentateuque | S | DECISION | NONONONON (source_variants NONONONO@27) |
| S | S[ouioui]/lie-a-david | DECISION | OUIOUIOUI (source_variants OUIOUIOUIOUI@32) |
| S | S[non]/les-rois | DECISION | NON |
| ancien[non]/homme | E | DECISION | OUI |

## Characters

- One `bible_characters` row per CHARACTER node, except ABRAHAM and ABRAM, which share one row (name ABRAHAM, aliases {ABRAM}).
- Descriptions are generated as `"<clue> · <nearest CATEGORY label>"`. For example, the two JACQUES rows get `"Fils d'Alphée · LES EVANGILES"` and `"Fils de Zébédée · LES EVANGILES"`.

## Scenarios

"Prompt X → A" means: the Découvreur asks the current prompt (it must be X) and the Tireur answers A.

1. **Secret CAÏN, normal play:**
   - ANCIEN → OUI, HOMME → OUI, PENTATEUQUE → OUI, LIE A ADAM → OUI, CLASSE 1 → OUI, Premier homme → NON, Le meurtrier → OUI.
   - The prompt is now null (CHARACTER reached). Guess "caïn" → confirm OUI → DISCOVERED.
   - The revealed path has 7 steps in that order, plus the discovered name.
2. **Secret ABRAM (alias, TOME is a question):**
   - …PENTATEUQUE → OUI, LIE A ADAM → NON, LIE A ABRAHAM → OUI, PÈRE DE LA FOI → OUI, plus connu → NON, moin connu → OUI.
   - Guess "Abraham": the correct confirmation is NON (aliases don't count). Guess "ABRAM": OUI → DISCOVERED.
3. **Secret ISAAC:** …LIE A ABRAHAM → OUI, PÈRE DE LA FOI → NON, **TOME 1 → OUI**, FILS D'AGAR → NON, FILS DE LA PROMESSE → OUI → guess "Isaac" → OUI.
4. **Secret DAVID, repeated codes:**
   - ANCIEN → OUI, HOMME → OUI, PENTATEUQUE → "NONONO" (accepted, class NON_REPETE), LIVRE DE SAMUEL → "OUI OUI" (accepted, class OUI_REPETE), fils d'isaï → OUI, guess DAVID → OUI.
   - The correct-answer function returns the NON_REPETE and OUI_REPETE classes at those prompts.
5. **Secret JESUS-CHRIST:** ANCIEN → NON, HOMME → OUI, le sauveur → OUI, guess "Jésus Christ" → OUI (normalization ignores accents, hyphens and spaces).
6. **Name call at any time:** secret CAÏN. At the very first prompt (ANCIEN), guess "David" → the correct confirmation is NON; confirm NON → the prompt is still ANCIEN and the status is PLAYING.
7. **Tireur "QUESTION" ×1:**
   - Secret CAÏN. ANCIEN → OUI, HOMME → OUI, PENTATEUQUE → OUI, LIE A ADAM → **NON** (mistake). The prompt is now LIE A ABRAHAM.
   - Tireur rewind(1): the LIE A ADAM step is undone and the prompt is LIE A ADAM again. Answer OUI → the prompt is CLASSE 1.
   - The revealed path at the end doesn't contain the undone NON.
8. **Tireur "QUESTION" ×2:** after step 7's mistake (4 steps), rewind(2) → the prompt is PENTATEUQUE again.
9. **Découvreur goes back after a dead end:**
   - Secret CAÏN. ANCIEN → OUI, HOMME → OUI, PENTATEUQUE → NON (wrong), Serviteur de MOÏSE → NON.
   - The prompt is null and dead_end is true.
   - Découvreur goBack to the step of PENTATEUQUE (stepIndex 2) → the prompt is PENTATEUQUE, and the undone steps are flagged.
10. **Answer validation:**
    - At the PENTATEUQUE prompt, "JE NE SAIS PAS" is rejected. At the HOMME prompt it is accepted.
    - At the child prompt LIE A ADAM, "OUI OUI OUI" is rejected; only OUI and NON are allowed.
    - rewind(4) is rejected, and so is rewinding more steps than exist.
11. **AI:** for every playable secret, AI Tireur and AI Découvreur together reach DISCOVERED, and every AI Tireur answer equals the correct answer.
12. **Security (SQL only):**
    - The Découvreur can't read `game_secrets`, and `dsa_get_my_secret` raises an error for them.
    - `dsa_get_state` never contains the secret's node id or label before the end (unless it is the current prompt or already on the traversed path).
    - Non-admins can't write the graph tables, and `dsa_compute_answer` can't be executed by `authenticated`.
