/**
 * "Practise a part of the book" (backlog B7): the players may restrict which
 * name is drawn to one or more sections. The questions are unchanged — the pair
 * still walks the whole book down to that part — and the picker never shows a
 * name, a clue or a leaf.
 */
import React from 'react';
import { act, fireEvent, renderHook, waitFor } from '@testing-library/react-native';

import { setGameService } from '@/services';
import { OfflineGameService } from '@/services/offline-game-service';
import { useGame } from '@/state/use-game';
import { GameHeader } from '@/components';
import { ScopePicker, pickerRows } from '@/components/scope-picker';
import type { BookSection } from '@/services/types';

import { renderWithProviders } from './helpers';

const P = 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes';

/** The mini fixture's ids, looked up the way the app does: by label. */
async function sections(): Promise<{ service: OfflineGameService; rows: BookSection[]; id: (label: string) => string }> {
  const service = new OfflineGameService({ persist: false });
  const rows = await service.listSections('mini');
  const id = (label: string) => {
    const row = rows.find((r) => r.label === label);
    if (!row) throw new Error(`no section ${label}`);
    return row.node_id;
  };
  return { service, rows, id };
}

afterEach(() => setGameService(null));

describe('dsa_list_sections, through the service', () => {
  it('lists the sections with their counts, and no name, clue or leaf', async () => {
    const { service, rows } = await sections();
    const labels = rows.map((r) => r.label);

    expect(labels).toContain('ANCIEN');
    expect(labels).toContain('LIE A ADAM');
    expect(labels).toContain('CLASSE 1');
    expect(labels).toContain('LES EVANGILES');

    // Not one name and not one clue is in the picker's data.
    for (const forbidden of ['CAÏN', 'ADAM', 'DAVID', 'JESUS-CHRIST', 'JACQUES', 'Le meurtrier', 'Premier homme']) {
      expect(labels).not.toContain(forbidden);
    }

    const by = (label: string) => rows.find((r) => r.label === label);
    expect(by('LIE A ADAM')?.characters).toBe(2);
    expect(by('LES EVANGILES')?.characters).toBe(3);
    expect(by('CLASSE 1')?.characters).toBe(2);
    // The root holds the whole book.
    expect(rows.find((r) => r.parent_id === null)?.characters).toBe(13);

    await service.listSections('mini'); // stable across calls
  });
});

describe('the drawn name stays inside the scope', () => {
  it('draws only from the chosen section, over many games', async () => {
    const { service, id } = await sections();
    const scope = [id('LIE A ADAM')];
    for (let i = 0; i < 30; i++) {
      const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL', settings: { scope } });
      const secret = await service.getMySecret(sessionId);
      expect(['ADAM', 'CAÏN']).toContain(secret.name);
    }
  });

  it('a union of sections, and a scope with a single name', async () => {
    const { service, id } = await sections();
    const union = [id('CLASSE 1'), id('LES EVANGILES')];
    for (let i = 0; i < 20; i++) {
      const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL', settings: { scope: union } });
      expect(['ADAM', 'CAÏN', 'JESUS-CHRIST', 'JACQUES']).toContain((await service.getMySecret(sessionId)).name);
    }

    const alone = [id('LES 3 DERNIERS')];
    for (let i = 0; i < 5; i++) {
      const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL', settings: { scope: alone } });
      expect((await service.getMySecret(sessionId)).name).toBe('ESDRAS');
    }
  });

  it('a name change stays inside the scope, and runs out when the section is exhausted', async () => {
    const { service, id } = await sections();
    const { sessionId } = await service.createSession({
      graphSlug: 'mini',
      mode: 'LOCAL',
      settings: { scope: [id('LIE A ADAM')] },
    });
    const first = await service.getMySecret(sessionId);
    await service.redrawSecret(sessionId);
    const second = await service.getMySecret(sessionId);
    expect(second.name).not.toBe(first.name);
    expect(['ADAM', 'CAÏN']).toContain(second.name);
    // Only two names live there, so there is nothing left to draw.
    await expect(service.redrawSecret(sessionId)).rejects.toMatchObject({ code: 'NO_PLAYABLE_SECRET' });
  });

  it('the questions still start at the beginning', async () => {
    const { service, id } = await sections();
    const { sessionId } = await service.createSession({
      graphSlug: 'mini',
      mode: 'LOCAL',
      settings: { scope: [id('LES EVANGILES')] },
    });
    await service.tireurReady(sessionId);
    expect((await service.getState(sessionId)).prompt?.text).toBe('ANCIEN');
  });

  it('an empty scope is the whole book, and the state says which part was chosen', async () => {
    const { service, id } = await sections();
    const whole = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL' });
    expect((await service.getState(whole.sessionId)).settings.scope).toEqual([]);
    expect((await service.getState(whole.sessionId)).scope_labels).toEqual([]);

    const part = await service.createSession({
      graphSlug: 'mini',
      mode: 'LOCAL',
      settings: { scope: [id('LES EVANGILES')] },
    });
    const state = await service.getState(part.sessionId);
    expect(state.settings.scope).toEqual([id('LES EVANGILES')]);
    expect(state.scope_labels).toEqual(['LES EVANGILES']);
  });

  it('refuses a scope that is not a section, and one with no playable name', async () => {
    const { service, id } = await sections();
    await expect(
      service.createSession({ graphSlug: 'mini', mode: 'LOCAL', settings: { scope: ['not-a-section'] } }),
    ).rejects.toMatchObject({ code: 'INVALID_SETTINGS' });

    // A CHARACTER node is in the graph but is not a section.
    const cain = new OfflineGameService({ persist: false, secretNodeKey: `${P}/lie-a-adam/classe-1/le-meurtrier--cain` });
    const { sessionId } = await cain.createSession({ graphSlug: 'mini', mode: 'LOCAL' });
    const secretId = (await cain.getMySecret(sessionId)).node_id;
    await expect(
      service.createSession({ graphSlug: 'mini', mode: 'LOCAL', settings: { scope: [secretId] } }),
    ).rejects.toMatchObject({ code: 'INVALID_SETTINGS' });

    // And an unknown settings key is still refused.
    await expect(
      service.createSession({
        graphSlug: 'mini',
        mode: 'LOCAL',
        settings: { cheat: true } as unknown as { scope: string[] },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SETTINGS' });

    expect(id('LIE A ADAM')).toBeTruthy();
  });
});

describe('the picker, page by page', () => {
  it('shows the book’s outline, not the graph’s shape', async () => {
    const { rows } = await sections();
    const outline = pickerRows(rows);

    // The graph is a chain of questions — « ANCIEN » with two children both
    // called « HOMME ». The player reads the book's own map instead.
    expect(outline.map((row) => row.label)).toEqual(['Ancien Testament', 'Nouveau Testament']);
    expect(outline[0]?.children.map((row) => row.label)).toEqual([
      'PENTATEUQUE',
      'LES 3 PREMIERS',
      'LIVRE DE SAMUEL',
      'LES ROIS',
      'LES 3 DERNIERS',
    ]);
    // Each part counts only the names it really holds.
    expect(outline[0]?.characters).toBe(10);
    expect(outline[1]?.characters).toBe(3);
  });

  it('opens on the two testaments, and « Tout le livre » is one touch away', async () => {
    const { rows } = await sections();
    const chosen: string[][] = [];
    const screen = await renderWithProviders(
      <ScopePicker visible sections={rows} value={[]} onClose={() => undefined} onConfirm={(scope) => chosen.push(scope)} />,
    );

    expect(screen.getByTestId('scope-heading')).toHaveTextContent('D’où vient le nom à trouver ?');
    expect(screen.getByText('Ancien Testament')).toBeTruthy();
    expect(screen.getByText('Nouveau Testament')).toBeTruthy();
    // Nothing from deeper in the book is on this page.
    expect(screen.queryByText('PENTATEUQUE')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('scope-whole-book'));
    });
    expect(chosen).toEqual([[]]);
  });

  it('touching a part opens its own page, and the button at the bottom keeps it', async () => {
    const { rows } = await sections();
    const outline = pickerRows(rows);
    const ancien = outline[0]!;
    const chosen: string[][] = [];
    const screen = await renderWithProviders(
      <ScopePicker visible sections={rows} value={[]} onClose={() => undefined} onConfirm={(scope) => chosen.push(scope)} />,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId(`scope-row-${ancien.key}`));
    });

    // A page of its own: its name, where we are, and the lists it contains.
    expect(screen.getByTestId('scope-heading')).toHaveTextContent('Ancien Testament');
    expect(screen.getByTestId('scope-breadcrumb')).toHaveTextContent('Ancien Testament');
    expect(screen.getByText('PENTATEUQUE')).toBeTruthy();
    expect(screen.getByText('LIVRE DE SAMUEL')).toBeTruthy();
    expect(screen.queryByText('Nouveau Testament')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('scope-confirm'));
    });
    expect(chosen).toEqual([ancien.nodeIds]);
  });

  it('goes deeper, comes back up, and leaves the page at the top', async () => {
    const { rows } = await sections();
    const outline = pickerRows(rows);
    const ancien = outline[0]!;
    const pentateuque = ancien.children.find((row) => row.label === 'PENTATEUQUE')!;
    let closed = 0;
    const screen = await renderWithProviders(
      <ScopePicker visible sections={rows} value={[]} onClose={() => (closed += 1)} onConfirm={() => undefined} />,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId(`scope-row-${ancien.key}`));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId(`scope-row-${pentateuque.key}`));
    });
    expect(screen.getByTestId('scope-breadcrumb')).toHaveTextContent('Ancien Testament › PENTATEUQUE');
    expect(screen.getByText('LIE A ADAM')).toBeTruthy();

    // Back goes one page up, twice, and only then does it close the picker.
    await act(async () => {
      fireEvent.press(screen.getByTestId('top-back'));
    });
    expect(screen.getByTestId('scope-heading')).toHaveTextContent('Ancien Testament');
    await act(async () => {
      fireEvent.press(screen.getByTestId('top-back'));
    });
    expect(screen.getByTestId('scope-heading')).toHaveTextContent('D’où vient le nom à trouver ?');
    expect(closed).toBe(0);
    await act(async () => {
      fireEvent.press(screen.getByTestId('top-back'));
    });
    expect(closed).toBe(1);
  });

  it('a part with nothing under it is chosen by touching it', async () => {
    const { rows } = await sections();
    const outline = pickerRows(rows);
    const ancien = outline[0]!;
    const trois = ancien.children.find((row) => row.label === 'LES 3 PREMIERS')!;
    expect(trois.children).toHaveLength(0);
    const chosen: string[][] = [];
    const screen = await renderWithProviders(
      <ScopePicker visible sections={rows} value={[]} onClose={() => undefined} onConfirm={(scope) => chosen.push(scope)} />,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId(`scope-row-${ancien.key}`));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId(`scope-row-${trois.key}`));
    });
    expect(chosen).toEqual([trois.nodeIds]);

    // And that scope really is that part of the book.
    const service = new OfflineGameService({ persist: false });
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL', settings: { scope: trois.nodeIds } });
    expect((await service.getMySecret(sessionId)).name).toBe('JOSUE');
  });

  it('never renders a name or a clue', async () => {
    const { rows } = await sections();
    const screen = await renderWithProviders(
      <ScopePicker visible sections={rows} value={[]} onClose={() => undefined} onConfirm={() => undefined} />,
    );
    for (const forbidden of ['CAÏN', 'ADAM', 'DAVID', 'JESUS-CHRIST', 'Le meurtrier']) {
      expect(screen.queryByText(forbidden)).toBeNull();
    }
  });

  it('an old server, with no answers in its rows, still never shows the START node', async () => {
    const { rows } = await sections();
    const old = rows.map((row) => ({ ...row, node_type: null, answer_label: null }));
    const screen = await renderWithProviders(
      <ScopePicker visible sections={old} value={[]} onClose={() => undefined} onConfirm={() => undefined} />,
    );
    expect(screen.queryByText('DSA')).toBeNull();
    expect(screen.getByText('ANCIEN')).toBeTruthy();
  });
});

describe('the game screen', () => {
  it('writes which part of the book is being practised', async () => {
    const { service, id } = await sections();
    const { sessionId } = await service.createSession({
      graphSlug: 'mini',
      mode: 'LOCAL',
      settings: { scope: [id('LES EVANGILES')] },
    });
    await service.tireurReady(sessionId);

    const { result } = await renderHook(() => useGame(sessionId, { service, aiAnswerBeatMs: 0 }));
    await waitFor(() => expect(result.current.state).not.toBeNull());

    const screen = await renderWithProviders(<GameHeader game={result.current} viewRole="DECOUVREUR" />);
    expect(screen.getByTestId('scope-summary')).toHaveTextContent('Partie : LES EVANGILES');
  });

  it('says nothing when the whole book is in play', async () => {
    const { service } = await sections();
    const { sessionId } = await service.createSession({ graphSlug: 'mini', mode: 'LOCAL' });
    await service.tireurReady(sessionId);

    const { result } = await renderHook(() => useGame(sessionId, { service, aiAnswerBeatMs: 0 }));
    await waitFor(() => expect(result.current.state).not.toBeNull());

    const screen = await renderWithProviders(<GameHeader game={result.current} viewRole="DECOUVREUR" />);
    expect(screen.queryByTestId('scope-summary')).toBeNull();
  });
});
