# GAME RULES — DSA (Découverte Sans Alphabet)

These rules were confirmed by the project owner on 2026-09-15. The source book (private, never in the repo) is the source of truth for every question, its order and its answer codes.

## Roles

- **Tireur:** draws a secret Bible name card. The card shows the name, plus a short description (clue · section) so that people who share a name can be told apart. The Tireur answers questions and never says the name.
- **Découvreur:** follows the book's questions to find the name.

## 1. The questions follow the book, in the book's order

The book has two kinds of question points.

1. **Answer-code questions (the "spine"), drawn on page 2 and on the path banner pages.**
   - The Découvreur asks: ANCIEN ? → HOMME ? → PENTATEUQUE ? → LIVRE DE SAMUEL ? → LES ROIS ? …
   - The Tireur answers with a **code** that sends the game to a branch:
     - `OUI` / `NON`
     - `OUIOUI…`: a OUI that is **held long** ("ouiiii"), meaning "a different category". **The length or the number of repetitions doesn't matter**; what matters is that the sound is clearly different from a plain OUI.
     - `NONNON…`: the same idea with NON.
     
     In this community the code is spoken as **one stretched sound** rather than a repeated word, so the app decides mainly from how long the voice lasts (GRAPH_SPECIFICATION §1, "Recognising the Tireur's answers").
     - `JE NE SAIS PAS`
2. **Section trees (every other page).**
   - Inside a section, the Découvreur asks the children **exactly in the order printed in the book**, using exactly the book's wording.
   - This includes "TOME 1 ?", "1ère classe ?", "1er ?", "plus connu ?" and "Le révolté ?".
   - The Tireur answers `OUI`, which means going into that child, or `NON`, which means moving on to the next child in the book's order.
   - CLASSE groups and ordinals are asked **in book order, never alphabetically**.
   - When the Tireur says OUI to a name clue ("Le révolté ?"), the Découvreur still has to say the name ("ABSALOM !").

### How questions are said (owner, 2026-09-16)

The Découvreur says the book label **directly**, as a question: **"Ancien ?"**, **"Homme ?"**, **"Pentateuque ?"**, **"Lié à David ?"**, **"Le meurtrier ?"**. Nobody says "Est-ce Ancien ?" or "Est-ce un homme ?": both players know the book, so the label alone is the question. The app follows this everywhere, on screen and when it speaks. It still understands a longer phrasing if someone uses one.

## 2. Calling a name at any time

- At **any** point, the Découvreur may call a name.
- If it's the secret name, the Tireur says **OUI** and the game is over (discovered).
- If it isn't, the Tireur says **NON** and the game continues from the same place.

## 3. Going back (Découvreur)

If the Découvreur named the wrong leaf, or reaches the end of a list without a OUI, they can **go back to an earlier question** on the path they've taken and continue from there. That question gets asked again.

## 4. "QUESTION" — the Tireur corrects a mistake

- If the Tireur realizes an earlier answer was wrong, they say **"QUESTION"** once, twice or three times.
- The number of times tells the Découvreur **how many lists to go back up**, not how many questions to undo.
- **"QUESTION" ×1** sends the pair back to the question that **opened the list they are in**. That question is asked again, everything answered since is undone, and the Tireur gives the corrected answer. ×2 goes one list higher, ×3 one higher still.
- A mistake is recovered in **one step**, however many names were asked inside the list.

**What counts as a list.** A step goes one list deeper when it is a **spine answer** (ANCIEN, HOMME, PENTATEUQUE… — an answer code always moves) or a **OUI on an item of a list**. A **NON on an item is not** a new list: it only moves on to the next item.

**Examples.**

| Where the pair is | "QUESTION" ×1 asks again |
|---|---|
| "1ère classe ?" → OUI, then "1er ?" → NON, "2ème ?" → NON | **"1ère classe ?"** — answering NON then moves to the next class |
| "PENTATEUQUE ?" → OUI, then "LIE A ADAM ?" → NON *(the mistake)*, now at "LIE A ABRAHAM ?" | **"PENTATEUQUE ?"** — the question that opened this list; the pair asks down again |
| A spine question was just answered and nothing has been asked since | that same spine question |

- If there are fewer lists above than the Tireur asked for, the pair goes back to the **very first question**. That is not an error.
- The undone questions stay recorded as undone, and the game's statistics count **one** "QUESTION".
- The Découvreur's own **"Revenir à une question"** (§3) is unchanged: they pick any earlier question on their path.

## 5. Truthful answers

- An AI Tireur always answers correctly: the answer is computed from the secret and the graph.
- A human Tireur isn't blocked from making a mistake, just as in the physical game. The "QUESTION" rule is how mistakes get corrected.

## 6. End of the game

- The end screen shows the name and the game statistics, then **the book's own path to the name** (animated graph), whatever the outcome. See "Time limits, name changes and learning from a lost game", point 5.

## The name card

The Tireur's card shows the name. **A short description is added only when several people in the book share that name** (for example LEMEC, HENOC, JOAS), so the Tireur knows which one to have discovered. Admins can improve those descriptions (admin panel, "Homonymes").

## Time limits, name changes and learning from a lost game (owner, 2026-09-17; built by S9)

1. **The timer is optional.** In "Préparer la partie" (and when creating a room), a checkbox **« Jouer avec le chronomètre »**, unchecked by default. The room creator chooses for both players.
2. **With the timer:**
   - **Thinking time (default 40 s):** when the Tireur receives the name, they have this long to work out the path to it in the book. "Je suis prêt" ends it early.
   - **Game time (default 120 s):** then the clock runs for both players. If the name isn't discovered in time, **both players lose**.
   - The admin sets both durations in the admin panel ("Réglages").
3. **Changing the name (owner, 2026-09-17):** if the Tireur can't find the drawn name in the book, they can **draw another name, at most 2 times per game** (admin setting, default 2), **only before the game starts**: while looking at the card, before "Je suis prêt". Once the questions have started, the name can't be changed; the Tireur can only abandon. A name already drawn in that game never comes back. The Découvreur only sees "Le Tireur a changé de nom". With the timer, a new name gives a **fresh thinking time**. This works with or without the timer.
4. **The game time is fixed.** Nothing adds or removes time: rewinds ("QUESTION"), going back or wrong name calls all happen inside the same 120 s. In a room, the clock only starts once both players are there.
5. **The end screen always teaches the book's path** (discovered, time up or abandoned):
   - first the **game card**: the name, the statistics (questions, NON answers, back-steps, "QUESTION" rewinds) and, **if the timer was on and the name was found, the time it took** (for example "Trouvé en 1 min 12 s sur 2 min");
   - then **the book's actual path to the name** as the animated graph: every question in book order with the right answers, down to the name. It's **not** the players' own path, with its detours and back-steps.
   - During the game, "Voir le chemin" still shows the players' own path so far (the book's path can't be shown before the end).

## Modes

| Mode | Tireur | Découvreur |
|---|---|---|
| HUMAN_VS_HUMAN | person on device A | person on device B (room code `DSA-1234`) |
| AI_TIREUR | application | person |
| AI_DECOUVREUR | person | application (asks the book's questions in order, calls the name after an OUI on a clue) |
| LOCAL | same device, passed between players; **the Tireur goes first** (sees the card, then passes the phone) | same device |

## Still open (see DIGITIZATION_REPORT.md §9)

- "LIÉ À JOB" is asked after "LES PETITS PROPHÈTES" (HOMME → OUIOUIOUI branch), by owner decision. "LIVRE POÉTIQUE" is placed after it and still needs admin confirmation.
- **O1 (confirmed):** on radial mind maps, branches without numbers are asked right-hand column top to bottom, then left-hand column top to bottom. When branches are numbered, the numbers set the order.
- Calling a name is only correct when it is **the exact name on the card** (the node's label). Another name for the same person (for example ABRAHAM when the card says ABRAM) doesn't count.
