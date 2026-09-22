/**
 * The two shared rule scenarios, played end to end through the real hook and the
 * real offline service (docs/sessions/mini-graph-fixture.md, scenarios 1 and 7).
 * Nothing is stubbed below `useGame`: the engine in `@dsa/core` decides.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { OfflineGameService } from '@/services/offline-game-service';
import { useGame } from '@/state/use-game';

const CAIN = 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1/le-meurtrier--cain';

function service() {
  return new OfflineGameService({ persist: false, secretNodeKey: CAIN });
}

describe('scenario 1 — secret CAÏN, normal play (AI Tireur)', () => {
  it('walks the book to the leaf and ends DISCOVERED', async () => {
    const offline = service();
    const { sessionId } = await offline.createSession({ graphSlug: 'mini', mode: 'AI_TIREUR' });

    const { result } = await renderHook(() => useGame(sessionId, { service: offline, aiAnswerBeatMs: 0 }));
    await waitFor(() => expect(result.current.state).not.toBeNull());

    expect(result.current.state?.prompt?.text).toBe('ANCIEN');
    expect(result.current.activeRole).toBe('DECOUVREUR');
    // The Découvreur never holds the Tireur role in AI_TIREUR mode.
    expect(result.current.myRoles).toEqual(['DECOUVREUR']);

    const expected = [
      ['ANCIEN', 'OUI'],
      ['HOMME', 'OUI'],
      ['PENTATEUQUE', 'OUI'],
      ['LIE A ADAM', 'OUI'],
      ['CLASSE 1', 'OUI'],
      ['Premier homme', 'NON'],
      ['Le meurtrier', 'OUI'],
    ];

    for (const [text] of expected) {
      expect(result.current.state?.prompt?.text).toBe(text);
      await act(async () => {
        await result.current.ask();
      });
    }

    // The leaf is reached: no prompt, not a dead end — the name must be called.
    expect(result.current.state?.prompt).toBeNull();
    expect(result.current.state?.dead_end).toBe(false);
    expect(result.current.state?.path.map((p) => [p.text, p.answer_label])).toEqual(expected);

    // AI_TIREUR confirms the call in the same round trip.
    await act(async () => {
      await result.current.guess('caïn');
    });

    expect(result.current.state?.status).toBe('DISCOVERED');

    const reveal = await offline.getRevealedPath(sessionId);
    expect(reveal.winner).toBe('DECOUVREUR');
    expect(reveal.path).toHaveLength(7);
    expect(reveal.secret?.name).toBe('CAÏN');
    expect(reveal.secret?.description).toBe('Le meurtrier · LIE A ADAM');
    // GRAPH_SPECIFICATION §8: CAÏN is the only CAÏN, so the card shows no description.
    expect(reveal.secret?.has_homonyms).toBe(false);
    expect(reveal.stats).toMatchObject({ questions: 7, non: 1, backs: 0, rewinds: 0, timed: false });
    expect(reveal.path.map((p) => [p.prompt_kind, p.node_type, p.target_text])[2]).toEqual([
      'SPINE',
      'QUESTION',
      'PENTATEUQUE (HOMMES)',
    ]);
  });

  it('refuses a wrong name and leaves the position untouched', async () => {
    const offline = service();
    const { sessionId } = await offline.createSession({ graphSlug: 'mini', mode: 'AI_TIREUR' });
    const { result } = await renderHook(() => useGame(sessionId, { service: offline, aiAnswerBeatMs: 0 }));
    await waitFor(() => expect(result.current.state).not.toBeNull());

    await act(async () => {
      await result.current.guess('DAVID');
    });

    expect(result.current.state?.status).toBe('PLAYING');
    expect(result.current.state?.pending_guess).toBeNull();
    expect(result.current.state?.prompt?.text).toBe('ANCIEN');
    expect(result.current.state?.path).toHaveLength(0);
    // AI_TIREUR refuses in the same round trip, so the hook must still report it.
    expect(result.current.refusedGuess).toBe('DAVID');

    await act(async () => {
      await result.current.ask();
    });
    expect(result.current.refusedGuess).toBeNull();
  });
});

describe('scenario 7 — the Tireur says "QUESTION" once (LOCAL)', () => {
  it('undoes the wrong NON and keeps it out of the revealed path', async () => {
    const offline = service();
    const { sessionId } = await offline.createSession({ graphSlug: 'mini', mode: 'LOCAL' });
    await offline.tireurReady(sessionId);

    const { result } = await renderHook(() => useGame(sessionId, { service: offline, aiAnswerBeatMs: 0 }));
    await waitFor(() => expect(result.current.state).not.toBeNull());

    // LOCAL holds both roles on one device.
    expect(result.current.myRoles.sort()).toEqual(['DECOUVREUR', 'TIREUR']);
    expect(result.current.isLocal).toBe(true);

    const play = async (label: string) => {
      await act(async () => {
        await result.current.ask();
      });
      expect(result.current.activeRole).toBe('TIREUR');
      await act(async () => {
        await result.current.answer(label);
      });
    };

    await play('OUI'); // ANCIEN
    await play('OUI'); // HOMME
    await play('OUI'); // PENTATEUQUE
    expect(result.current.state?.prompt?.text).toBe('LIE A ADAM');

    await play('NON'); // the Tireur's mistake
    expect(result.current.state?.prompt?.text).toBe('LIE A ABRAHAM');
    expect(result.current.state?.path).toHaveLength(4);

    await act(async () => {
      await result.current.rewind(1);
    });

    expect(result.current.state?.prompt?.text).toBe('LIE A ADAM');
    expect(result.current.state?.path).toHaveLength(3);
    expect(result.current.state?.awaiting).toBe('QUESTION');

    await play('OUI'); // the corrected answer
    expect(result.current.state?.prompt?.text).toBe('CLASSE 1');

    const reveal = await offline.getRevealedPath(sessionId);
    expect(reveal.path.map((p) => [p.text, p.answer_label])).toEqual([
      ['ANCIEN', 'OUI'],
      ['HOMME', 'OUI'],
      ['PENTATEUQUE', 'OUI'],
      ['LIE A ADAM', 'OUI'],
    ]);
    // The undone NON is gone from the path the players will be shown.
    expect(reveal.path.some((p) => p.answer_label === 'NON')).toBe(false);
    // …but the server-side counts still include it, and the rewind.
    expect(reveal.stats).toMatchObject({ questions: 5, non: 1, backs: 0, rewinds: 1 });
  });

  it('records the book’s canonical label, not the spoken one', async () => {
    const offline = service();
    const { sessionId } = await offline.createSession({ graphSlug: 'mini', mode: 'LOCAL' });
    await offline.tireurReady(sessionId);
    const { result } = await renderHook(() => useGame(sessionId, { service: offline, aiAnswerBeatMs: 0 }));
    await waitFor(() => expect(result.current.state).not.toBeNull());

    await act(async () => {
      await result.current.ask();
    });
    await act(async () => {
      await result.current.answer('OUI');
    });
    await act(async () => {
      await result.current.ask();
    });
    await act(async () => {
      await result.current.answer('OUI');
    });
    await act(async () => {
      await result.current.ask();
    });
    // "NONONO" is the spoken form; the book prints NONONONON.
    await act(async () => {
      await result.current.answer('NONONO');
    });

    expect(result.current.state?.path[2]?.answer_label).toBe('NONONONON');
    expect(result.current.state?.prompt?.text).toBe('LIVRE DE SAMUEL');
  });
});
