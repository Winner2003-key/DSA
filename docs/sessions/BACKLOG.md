# Backlog: owner remarks waiting to be scheduled

Recorded by the lead. Each item becomes part of a session brief when the owner says so. **Don't implement these in an unrelated session.**

---

## B1 — "QUESTION ×N" goes back to the node that opened the list, not to the previous question (owner, 2026-09-17)

**Rule change.** Today (GAME_RULES §4, core `rewind`, SQL `dsa_rewind`), "QUESTION ×N" undoes the last N **answered questions**. The owner's rule: it takes the Découvreur back N **levels**, to the question that **opened** the list they're in, so the pair recovers fast.

**Owner's example.**
- Découvreur: "1ère classe ?" → Tireur: "OUI". The Découvreur is now asking names inside 1ère classe: "1er ?" → "NON", "2ème ?" → …
- The Tireur realizes the name is **not** in 1ère classe and says "QUESTION".
- The Découvreur asks **"1ère classe ?"** again (not "2ème ?"), gets "NON", and they continue with "2ème classe ?".

**Proposed precise definition (confirm with the owner when scheduling):**
- An answered step **enters a level** when it's a spine answer (a DECISION edge always moves into a new node) or a child prompt answered **OUI**.
- A child prompt answered **NON** doesn't enter a level; it moves on to the next sibling.
- "QUESTION ×N" finds the N-th most recent **entering** step and undoes it together with every step after it. The prompt becomes that step's question again.
  - ×1: re-ask the question that opened the current list.
  - ×2: the one that opened the list above it, and so on.
- If there are fewer than N entering steps, go back to the first question.
- Undone steps keep being recorded as undone, and the stats count one rewind.

**To confirm, with an example for the owner:** a wrong **NON** on a sibling (for example "LIE A ADAM ?" → "NON" by mistake, now at "LIE A ABRAHAM ?") hasn't entered a level. "QUESTION" then goes back to the question that opened this list ("PENTATEUQUE ?"), and they re-ask down to "LIE A ADAM ?".

**Impact:** core `rewind` and its tests; SQL `dsa_rewind` plus `90_tests` scenarios 7–8; app wording ("QUESTION ×1" explanation); the voice intent is unchanged (the word "question" said 1–3 times); GAME_RULES §4; GRAPH_SPECIFICATION §2. The Découvreur's own "Revenir à une question" (pick any earlier question) stays as it is.

---

## B2 — Icons instead of text-heavy buttons (owner, 2026-09-17)

- The UI has many buttons carrying text. Use **clear icons** where they're unambiguous, with short labels kept for accessibility (screen-reader labels always).
  - Suggestions: microphone, back arrow for "Revenir", rewind icon for "QUESTION", flip or eye for show/hide card, share, QR, settings gear, play/replay, flag or exit for abandon, speaker/mute, timer.
- Use an icon set included in Expo Go (`@expo/vector-icons`). Test the icons with non-technical players: an icon that needs explaining gets its label back.

## B3 — An African-accented voice, male or female, adjustable speed (owner, 2026-09-17)

- **Wanted:** a voice that sounds **African French** rather than European French; the player chooses **male or female**; speed is adjustable, including **very fast**.
- **To research before promising anything:**
  - **On-device voices** (expo-speech / Web Speech) depend on the phone; African French voices are rarely installed. What we can always offer is listing the device's French voices with a preview, choosing male/female where the device labels it, and pitch and rate.
  - **Cloud text-to-speech** providers with African French voices: check which exist today, their quality, price and free tiers. Keys stay in a Supabase Edge Function, like `transcribe`.
  - **Recorded human voices** for the short fixed phrases (OUI, NON, the held OUIIII / NONNNN, JE NE SAIS PAS, QUESTION, and a few prompts like "Je n'ai pas bien compris"), recorded by real speakers from the community, male and female. That's authentic and free. Book labels (the questions) still need text-to-speech, or recordings later.
- The speed setting applies to every option.

## B4 — A Settings screen (owner, 2026-09-17)

A **Réglages** screen in the app (not the admin), stored per device:
- **Voice:** voice choice with a preview, male/female, speed (up to very fast), volume or mute, and redoing the held-OUI calibration.
- **Play defaults:** Voix/Boutons, timer on/off by default, player name.
- **Comfort:** light/dark/automatic theme, text size, haptics on/off, sounds on/off, reduced motion.
- **Other player choices** that don't change the game rules: for example whether the AI Découvreur pauses before asking, and hold-to-talk vs free talk.

## B5 — Voice-first, hands-free play (owner, 2026-09-17): the main goal

**The owner's goal:** digitize the experience of playing with **only a piece of paper with the name**. Once the game is set up, **both players only talk**. They shouldn't need to look at or touch the screen unless something goes wrong.

Directions to design in a dedicated session (after S7c live voice):
- **Automatic turn-taking listening.** When it's your turn, the phone listens on its own (it detects the end of speech after silence). No hold-to-talk, no tap. A short sound cue says whose turn it is.
- **Everything spoken back:**
  - the Découvreur hears the answer; the Tireur hears the question;
  - misunderstood speech gets "Je n'ai pas bien compris, répète";
  - the held-OUI borderline case is resolved **by voice** ("Oui simple ou oui long ?") before falling back to buttons;
  - spoken timer warnings ("Plus que 30 secondes");
  - the discovery announced aloud;
  - spoken commands: "Répète", "Pause", "Abandonner".
- **The screen is only a mirror** of what's said. The game must be finishable face down on the table.
- **Robustness:** background noise, two people talking over each other, and the phone's own voice never picked up as an answer.
- **With live voice between phones (S7c),** each phone recognizes only its own player's speech.

---

## Planned order (proposal, to confirm with the owner)
1. S9 (timer, running or ready)
2. S7c (live voice between phones)
3. **S10:** B1 (rewind rule), B2 (icons), B4 (settings) and the device-voice part of B3
4. **S11:** B5 (hands-free voice-first play), with any cloud or recorded voice from B3
5. S8 (security and release readiness)
