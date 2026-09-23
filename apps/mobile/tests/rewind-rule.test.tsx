/**
 * "QUESTION" ×N goes back to the question that **opened the list** the Découvreur
 * is in, not to the previous question (GAME_RULES.md §4, backlog B1).
 *
 * Everything runs through the real offline service, which mirrors the server, so
 * these are the same scenarios as `90_tests.sql` blocks 7–8d.
 */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { setGameService } from '@/services';
import { OfflineGameService } from '@/services/offline-game-service';
import { useGame } from '@/state/use-game';
import { DecouvreurView } from '@/views/decouvreur-view';
import { TireurView } from '@/views/tireur-view';

import { renderWithProviders } from './helpers';

const P = 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes';
const CAIN = `${P}/lie-a-adam/classe-1/le-meurtrier--cain`;

async function playing(labels: string[]) {
  const service = new OfflineGameService({ persist: false, secretNodeKey: CAIN });
  const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL' });
  await service.tireurReady(sessionId);
  for (const label of labels) {
    await service.ask(sessionId);
    await service.answer(sessionId, label);
  }
  return { service, sessionId };
}

const prompt = async (service: OfflineGameService, sessionId: string) =>
  (await service.getState(sessionId)).prompt?.text ?? null;

afterEach(() => setGameService(null));

describe('the rule, through the service', () => {
  it('a wrong NON on a sibling: ×1 re-opens the list (PENTATEUQUE), not the previous question', async () => {
    const { service, sessionId } = await playing(['OUI', 'OUI', 'OUI', 'NON']);
    expect(await prompt(service, sessionId)).toBe('LIE A ABRAHAM');

    const state = await service.rewind(sessionId, 1);
    expect(state.prompt?.text).toBe('PENTATEUQUE');
    expect(state.path).toHaveLength(2);

    // The pair asks down again and gets it right.
    await service.ask(sessionId);
    await service.answer(sessionId, 'OUI');
    expect(await prompt(service, sessionId)).toBe('LIE A ADAM');
  });

  it('inside a list: ×1 re-asks the question that opened it, and NON then moves on', async () => {
    // The owner's first example: "1ère classe ?" OUI, then NON on the names inside.
    const { service, sessionId } = await playing(['OUI', 'OUI', 'OUI', 'OUI', 'OUI', 'NON', 'NON']);
    expect(await prompt(service, sessionId)).toBeNull(); // past the last child of CLASSE 1

    const state = await service.rewind(sessionId, 1);
    expect(state.prompt?.text).toBe('CLASSE 1');
    expect(state.path).toHaveLength(4);

    // NON on CLASSE 1 now walks to the next sibling of the list above it.
    await service.ask(sessionId);
    await service.answer(sessionId, 'NON');
    expect(await prompt(service, sessionId)).toBeNull(); // CLASSE 1 is the only child
    expect((await service.rewind(sessionId, 1)).prompt?.text).toBe('LIE A ADAM');
  });

  it('×2 goes one list higher, ×3 higher still', async () => {
    const two = await playing(['OUI', 'OUI', 'OUI', 'NON']);
    expect((await two.service.rewind(two.sessionId, 2)).prompt?.text).toBe('HOMME');

    const three = await playing(['OUI', 'OUI', 'OUI', 'NON']);
    const state = await three.service.rewind(three.sessionId, 3);
    expect(state.prompt?.text).toBe('ANCIEN');
    expect(state.path).toHaveLength(0);
  });

  it('right after a spine answer, ×1 re-asks that spine question', async () => {
    const { service, sessionId } = await playing(['OUI', 'OUI', 'OUI']);
    expect(await prompt(service, sessionId)).toBe('LIE A ADAM');
    const state = await service.rewind(sessionId, 1);
    expect(state.prompt?.text).toBe('PENTATEUQUE');
    expect(state.path).toHaveLength(2);
  });

  it('fewer levels than asked for: back to the very first question, not an error', async () => {
    for (const count of [1, 2, 3] as const) {
      const { service, sessionId } = await playing(['OUI']);
      const state = await service.rewind(sessionId, count);
      expect(state.prompt?.text).toBe('ANCIEN');
      expect(state.path).toHaveLength(0);
    }
    // Two NON inside the same list are not levels either.
    const deep = await playing(['OUI', 'OUI', 'OUI', 'NON', 'NON']);
    expect((await deep.service.rewind(deep.sessionId, 3)).prompt?.text).toBe('ANCIEN');
  });

  it('INVALID_REWIND is only about N and an empty path', async () => {
    const empty = await playing([]);
    await expect(empty.service.rewind(empty.sessionId, 1)).rejects.toMatchObject({ code: 'INVALID_REWIND' });

    const { service, sessionId } = await playing(['OUI']);
    await expect(service.rewind(sessionId, 0 as 1)).rejects.toMatchObject({ code: 'INVALID_REWIND' });
    await expect(service.rewind(sessionId, 4 as 3)).rejects.toMatchObject({ code: 'INVALID_REWIND' });
  });

  it('a refused name is not a level: ×1 still re-opens the list', async () => {
    const { service, sessionId } = await playing(['OUI', 'OUI', 'OUI', 'OUI']);
    await service.guess(sessionId, 'ADAM');
    await service.confirmGuess(sessionId, 'NON');
    expect(await prompt(service, sessionId)).toBe('CLASSE 1');

    const state = await service.rewind(sessionId, 1);
    expect(state.prompt?.text).toBe('LIE A ADAM');
    expect(state.pending_guess).toBeNull();
    expect((await service.getRevealedPath(sessionId)).stats).toMatchObject({ rewinds: 1 });
  });

  it('the undone steps stay recorded, and the stats count one rewind', async () => {
    const { service, sessionId } = await playing(['OUI', 'OUI', 'OUI', 'NON']);
    await service.rewind(sessionId, 1);
    const reveal = await service.getRevealedPath(sessionId);
    // The revealed path shows only what still stands.
    expect(reveal.path.map((p) => p.text)).toEqual(['ANCIEN', 'HOMME']);
    expect(reveal.stats).toMatchObject({ rewinds: 1, backs: 0, non: 1 });
  });
});

describe('on screen', () => {
  it('the Tireur can say QUESTION ×1, ×2 or ×3 as soon as one answer exists', async () => {
    const { service, sessionId } = await playing(['OUI']);
    const { result } = await renderHook(() => useGame(sessionId, { service, aiAnswerBeatMs: 0 }));
    await waitFor(() => expect(result.current.state).not.toBeNull());

    const screen = await renderWithProviders(<TireurView sessionId={sessionId} game={result.current} />);
    // One answered step is enough for all three: asking for more goes to the start.
    for (const count of [1, 2, 3]) {
      expect(screen.getByTestId(`rewind-${count}`).props.accessibilityState.disabled).toBe(false);
    }
  });

  it('the Découvreur is told which question to go back to', async () => {
    const { service, sessionId } = await playing(['OUI', 'OUI', 'OUI', 'NON']);
    const { result } = await renderHook(() => useGame(sessionId, { service, aiAnswerBeatMs: 0 }));
    await waitFor(() => expect(result.current.state).not.toBeNull());

    await act(async () => {
      await result.current.rewind(1);
    });
    expect(result.current.rewoundTo).toBe('PENTATEUQUE');

    const screen = await renderWithProviders(<DecouvreurView game={result.current} />);
    expect(screen.getByTestId('rewound-to')).toBeTruthy();
    expect(screen.getByTestId('rewound-to')).toHaveTextContent('Le Tireur demande de revenir à « PENTATEUQUE ? ».');
  });

  it('a rewind all the way back says so instead of naming the first question', async () => {
    const { service, sessionId } = await playing(['OUI']);
    const { result } = await renderHook(() => useGame(sessionId, { service, aiAnswerBeatMs: 0 }));
    await waitFor(() => expect(result.current.state).not.toBeNull());

    await act(async () => {
      await result.current.rewind(2);
    });
    const screen = await renderWithProviders(<DecouvreurView game={result.current} />);
    expect(screen.getByTestId('rewound-to')).toHaveTextContent(
      'Le Tireur demande de tout reprendre depuis la première question.',
    );
  });

  it("the Découvreur's own « Revenir » shows no Tireur notice", async () => {
    const { service, sessionId } = await playing(['OUI', 'OUI', 'OUI', 'NON']);
    const { result } = await renderHook(() => useGame(sessionId, { service, aiAnswerBeatMs: 0 }));
    await waitFor(() => expect(result.current.state).not.toBeNull());

    await act(async () => {
      await result.current.goBack(2);
    });
    expect(result.current.rewoundTo).toBeNull();

    const screen = await renderWithProviders(<DecouvreurView game={result.current} />);
    expect(screen.queryByTestId('rewound-to')).toBeNull();
  });

  it('the notice goes away once the pair moves on', async () => {
    const { service, sessionId } = await playing(['OUI', 'OUI', 'OUI', 'NON']);
    const { result } = await renderHook(() => useGame(sessionId, { service, aiAnswerBeatMs: 0 }));
    await waitFor(() => expect(result.current.state).not.toBeNull());

    await act(async () => {
      await result.current.rewind(1);
    });
    expect(result.current.rewoundTo).toBe('PENTATEUQUE');

    await act(async () => {
      await result.current.ask();
    });
    await act(async () => {
      await result.current.answer('OUI');
    });
    expect(result.current.rewoundTo).toBeNull();
  });
});
