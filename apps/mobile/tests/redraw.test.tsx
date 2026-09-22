/**
 * "Changer de nom" (GRAPH_SPECIFICATION §9, GAME_RULES point 3): a Tireur who
 * cannot find the drawn name in the book may draw another one — at most twice,
 * and only before the questions start. The Découvreur is told that the name
 * changed, and never which name.
 */
import React from 'react';
import { act, fireEvent, renderHook, waitFor } from '@testing-library/react-native';

import { setGameService } from '@/services';
import { OfflineGameService } from '@/services/offline-game-service';
import { useGame } from '@/state/use-game';
import { GameTable } from '@/views/game-table';
import { DecouvreurWaitingView } from '@/views/decouvreur-waiting-view';

import { Providers, renderWithProviders, T0 } from './helpers';

const CAIN = 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1/le-meurtrier--cain';

function Table({ sessionId, service }: { sessionId: string; service: OfflineGameService }) {
  const game = useGame(sessionId, { service, aiAnswerBeatMs: 0, aiThinkingMs: 60_000 });
  return <GameTable sessionId={sessionId} game={game} />;
}

describe('the rule, through the service', () => {
  it('gives two changes and never the same name twice', async () => {
    const service = new OfflineGameService({ persist: false, secretNodeKey: CAIN });
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL' });

    expect((await service.getState(sessionId)).redraws_left).toBe(2);
    const drawn = [(await service.getMySecret(sessionId)).node_id];

    let state = await service.redrawSecret(sessionId);
    expect(state.redraws_used).toBe(1);
    expect(state.redraws_left).toBe(1);
    drawn.push((await service.getMySecret(sessionId)).node_id);

    state = await service.redrawSecret(sessionId);
    expect(state.redraws_used).toBe(2);
    expect(state.redraws_left).toBe(0);
    drawn.push((await service.getMySecret(sessionId)).node_id);

    expect(new Set(drawn).size).toBe(3);
    await expect(service.redrawSecret(sessionId)).rejects.toMatchObject({ code: 'NO_REDRAW_LEFT' });
  });

  it('is refused once the game has started', async () => {
    const service = new OfflineGameService({ persist: false, secretNodeKey: CAIN });
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL' });
    await service.tireurReady(sessionId);
    await expect(service.redrawSecret(sessionId)).rejects.toMatchObject({ code: 'GAME_STARTED' });

    await service.ask(sessionId);
    await service.answer(sessionId, 'OUI');
    await expect(service.redrawSecret(sessionId)).rejects.toMatchObject({ code: 'GAME_STARTED' });

    await service.abandon(sessionId);
    await expect(service.redrawSecret(sessionId)).rejects.toMatchObject({ code: 'GAME_OVER' });
  });

  it('is the Tireur’s alone', async () => {
    const service = new OfflineGameService({ persist: false, secretNodeKey: CAIN });
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'AI_TIREUR' });
    // The human is the Découvreur here, so there is no card of theirs to change.
    await expect(service.redrawSecret(sessionId)).rejects.toMatchObject({ code: 'WRONG_ROLE' });
  });

  it('never says which names were drawn', async () => {
    const service = new OfflineGameService({ persist: false, secretNodeKey: CAIN });
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL' });
    const first = await service.getMySecret(sessionId);
    const state = await service.redrawSecret(sessionId);
    const second = await service.getMySecret(sessionId);

    const json = JSON.stringify(state);
    expect(json).not.toContain(first.name);
    expect(json).not.toContain(first.node_id);
    expect(json).not.toContain(second.name);
    expect(json).not.toContain(second.node_id);
    // Only the count leaves the service.
    expect(state.redraws_used).toBe(1);
  });

  it('gives a fresh thinking time, and never more game time', async () => {
    let ms = Date.parse(T0);
    const service = new OfflineGameService({
      persist: false,
      secretNodeKey: CAIN,
      now: () => new Date(ms).toISOString(),
    });
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL', settings: { timed: true } });
    expect((await service.getState(sessionId)).think_ends_at).toBe(new Date(Date.parse(T0) + 40_000).toISOString());

    // 30 s of thinking gone, then a new card: the full 40 s start again.
    ms += 30_000;
    const state = await service.redrawSecret(sessionId);
    expect(state.think_ends_at).toBe(new Date(ms + 40_000).toISOString());
    expect(state.play_ends_at).toBeNull();

    // And the game time is still exactly 120 s, counted from the new ready moment.
    ms += 5_000;
    expect((await service.tireurReady(sessionId)).play_ends_at).toBe(new Date(ms + 120_000).toISOString());
  });

  it('does not exist when the admin turns it off', async () => {
    const service = new OfflineGameService({ persist: false, secretNodeKey: CAIN, appSettings: { maxRedraws: 0 } });
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL' });
    expect((await service.getState(sessionId)).redraws_left).toBe(0);
    await expect(service.redrawSecret(sessionId)).rejects.toMatchObject({ code: 'NO_REDRAW_LEFT' });
  });
});

describe('the Tireur’s screen', () => {
  it('offers the change with what is left, asks first, and flips the new card in', async () => {
    const service = new OfflineGameService({ persist: false, secretNodeKey: CAIN });
    setGameService(service);
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL' });
    const screen = await renderWithProviders(<Table sessionId={sessionId} service={service} />);

    // LOCAL hands the phone to the Tireur first.
    await act(async () => {
      fireEvent.press(await screen.findByTestId('pass-ready'));
    });
    await waitFor(() => expect(screen.getByTestId('tireur-ready')).toBeTruthy());
    expect(screen.getByTestId('tireur-redraw')).toHaveTextContent('Changer de nom · 2 restants');

    // It asks before changing anything.
    await act(async () => {
      fireEvent.press(screen.getByTestId('tireur-redraw'));
    });
    await waitFor(() => expect(screen.getByTestId('redraw-sheet')).toBeTruthy());
    expect(screen.getByText('Tu ne trouves pas ce nom dans le livre ?')).toBeTruthy();

    // "Non, je garde ce nom" leaves the card alone.
    await act(async () => {
      fireEvent.press(screen.getByTestId('redraw-cancel'));
    });
    expect((await service.getState(sessionId)).redraws_used).toBe(0);

    // And yes draws a new one, face down, with one change left.
    await act(async () => {
      fireEvent.press(screen.getByTestId('tireur-redraw'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('redraw-confirm'));
    });
    await waitFor(() => expect(screen.getByTestId('redraw-done')).toBeTruthy());
    expect(screen.getByTestId('tireur-redraw')).toHaveTextContent('Changer de nom · 1 restant');
    expect(screen.queryByText('CAÏN')).toBeNull();
  });

  it('takes the button away once the game has started', async () => {
    const service = new OfflineGameService({ persist: false, secretNodeKey: CAIN });
    setGameService(service);
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL' });
    const screen = await renderWithProviders(<Table sessionId={sessionId} service={service} />);

    await act(async () => {
      fireEvent.press(await screen.findByTestId('pass-ready'));
    });
    await waitFor(() => expect(screen.getByTestId('tireur-redraw')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByTestId('tireur-ready-done'));
    });
    await waitFor(() => expect(screen.queryByTestId('tireur-ready')).toBeNull());
    expect(screen.queryByTestId('tireur-redraw')).toBeNull();
  });

  it('never offers it when the admin has turned it off', async () => {
    const service = new OfflineGameService({ persist: false, secretNodeKey: CAIN, appSettings: { maxRedraws: 0 } });
    setGameService(service);
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL' });
    const screen = await renderWithProviders(<Table sessionId={sessionId} service={service} />);
    await act(async () => {
      fireEvent.press(await screen.findByTestId('pass-ready'));
    });
    await waitFor(() => expect(screen.getByTestId('tireur-ready')).toBeTruthy());
    expect(screen.queryByTestId('tireur-redraw')).toBeNull();
  });
});

describe('the Découvreur’s screen', () => {
  it('says that the name changed, and nothing more', async () => {
    const service = new OfflineGameService({ persist: false, secretNodeKey: CAIN });
    setGameService(service);
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'HUMAN_VS_HUMAN' });

    // This phone is the Découvreur: it waits, and its `useGame` sees the count rise.
    const { result } = await renderHook(() => useGame(sessionId, { service }), {
      wrapper: ({ children }: { children: React.ReactNode }) => <Providers>{children}</Providers>,
    });
    await waitFor(() => expect(result.current.state).not.toBeNull());

    await act(async () => {
      await service.redrawSecret(sessionId);
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.otherRedrew).toBe(true));

    const screen = await renderWithProviders(<DecouvreurWaitingView game={result.current} />);
    expect(screen.getByTestId('other-redrew')).toHaveTextContent('Le Tireur a changé de nom.');
    // The card itself is never on this screen.
    expect(screen.queryByText('CAÏN')).toBeNull();
  });
});
