/**
 * Every `DSA_<CODE>` the database can raise must reach the player as a French
 * sentence, never as raw SQL text (DATABASE_SCHEMA.md §3).
 */
import { fr } from '@/i18n/fr';
import { DsaError } from '@/services/errors';
import { SupabaseGameService, type RpcClient } from '@/services/supabase-game-service';

function failing(message: string): { service: SupabaseGameService; calls: { fn: string; args?: unknown }[] } {
  const calls: { fn: string; args?: unknown }[] = [];
  const client: RpcClient = {
    async rpc(fn, args) {
      calls.push({ fn, args });
      return { data: null, error: { message } };
    },
  };
  return { service: new SupabaseGameService({ client, ensureAuth: async () => undefined }), calls };
}

function succeeding(data: unknown): { service: SupabaseGameService; calls: { fn: string; args?: unknown }[] } {
  const calls: { fn: string; args?: unknown }[] = [];
  const client: RpcClient = {
    async rpc(fn, args) {
      calls.push({ fn, args });
      return { data, error: null };
    },
  };
  return { service: new SupabaseGameService({ client, ensureAuth: async () => undefined }), calls };
}

const SERVER_CODES = [
  'NOT_AUTHENTICATED',
  'NOT_PLAYER',
  'WRONG_ROLE',
  'WRONG_MODE',
  'GAME_OVER',
  'NOT_AWAITING_QUESTION',
  'NOT_AWAITING_ANSWER',
  'NOT_AWAITING_GUESS_CONFIRM',
  'NO_PROMPT',
  'ANSWER_NOT_ALLOWED',
  'INVALID_NAME',
  'INVALID_STEP',
  'INVALID_REWIND',
  'INVALID_MODE',
  'INVALID_ROLE',
  'GRAPH_NOT_FOUND',
  'GRAPH_INVALID',
  'NO_PLAYABLE_SECRET',
  'ROOM_CODE_EXHAUSTED',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
] as const;

describe('SupabaseGameService error mapping', () => {
  it.each(SERVER_CODES)('maps DSA_%s to its French message', async (code) => {
    const { service } = failing(`DSA_${code}: internal english detail`);
    await expect(service.getState('s1')).rejects.toBeInstanceOf(DsaError);
    await expect(service.getState('s1')).rejects.toMatchObject({
      code,
      message: fr.errors[code],
    });
  });

  it('never leaks the raw server text into the message', async () => {
    const { service } = failing('DSA_ROOM_FULL: session already has a TIREUR and a DECOUVREUR');
    const error: DsaError = await service
      .joinSession('DSA-1234')
      .then(() => {
        throw new Error('joinSession should have rejected');
      })
      .catch((e: unknown) => e as DsaError);
    expect(error.message).toBe(fr.errors.ROOM_FULL);
    expect(error.message).not.toMatch(/session already/);
    // The English text stays available for logs and reports.
    expect(error.detail).toMatch(/session already/);
  });

  it('maps an unknown DSA code, a permission error and a network failure', async () => {
    await expect(failing('DSA_SOMETHING_NEW: ...').service.ask('s1')).rejects.toMatchObject({
      code: 'UNKNOWN',
      message: fr.errors.UNKNOWN,
    });
    await expect(
      failing('permission denied for function dsa_compute_answer').service.ask('s1'),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', message: fr.errors.PERMISSION_DENIED });
    await expect(failing('TypeError: Failed to fetch').service.ask('s1')).rejects.toMatchObject({
      code: 'NETWORK',
      message: fr.errors.NETWORK,
    });
  });

  it('maps a thrown transport error too', async () => {
    const client: RpcClient = {
      rpc() {
        throw new Error('Network request failed');
      },
    };
    const service = new SupabaseGameService({ client, ensureAuth: async () => undefined });
    await expect(service.getState('s1')).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('reports a failed anonymous sign-in in French', async () => {
    const service = new SupabaseGameService({
      client: { async rpc() {
        return { data: null, error: null };
      } },
      ensureAuth: async () => {
        throw new Error('Auth session missing!');
      },
    });
    await expect(service.getState('s1')).rejects.toMatchObject({ code: 'NOT_AUTHENTICATED' });
  });
});

describe('SupabaseGameService call shapes', () => {
  it('unwraps the one-row array of dsa_create_session', async () => {
    const { service, calls } = succeeding([{ session_id: 'abc', room_code: 'DSA-1234' }]);
    await expect(service.createSession({ graphSlug: 'mini', mode: 'LOCAL' })).resolves.toEqual({
      sessionId: 'abc',
      roomCode: 'DSA-1234',
    });
    expect(calls[0]).toEqual({
      fn: 'dsa_create_session',
      args: {
        p_graph_slug: 'mini',
        p_mode: 'LOCAL',
        p_role: null,
        p_display_name: null,
        p_settings: { input_mode: 'BUTTONS' },
      },
    });
  });

  it('sends the chosen input mode in p_settings', async () => {
    const { service, calls } = succeeding([{ session_id: 'abc', room_code: 'DSA-1234' }]);
    await service.createSession({ graphSlug: 'mini', mode: 'AI_TIREUR', settings: { input_mode: 'VOICE' } });
    expect((calls[0]?.args as { p_settings: unknown }).p_settings).toEqual({ input_mode: 'VOICE' });
  });

  it('reads has_homonyms, stats and the new path fields', async () => {
    const entry = {
      step_index: 0,
      node_id: 'n',
      text: 'LIVRE DE SAMUEL',
      answer_label: 'OUIOUIOUI',
      prompt_kind: 'SPINE',
      node_type: 'QUESTION',
      target_text: 'LIE A DAVID',
    };
    const { service } = succeeding({
      status: 'DISCOVERED',
      winner: 'DECOUVREUR',
      path: [entry],
      stats: { questions: 5, non: 0, backs: 0, rewinds: 0 },
      secret: { node_id: 's', name: 'JACQUES', description: "Fils d'Alphée · LES EVANGILES", has_homonyms: true },
    });
    const reveal = await service.getRevealedPath('s1');
    expect(reveal.path).toEqual([entry]);
    expect(reveal.stats).toEqual({ questions: 5, non: 0, backs: 0, rewinds: 0 });
    expect(reveal.secret?.has_homonyms).toBe(true);

    const secretRow = succeeding([{ node_id: 's', name: 'CAÏN', description: 'x', has_homonyms: false }]);
    await expect(secretRow.service.getMySecret('s1')).resolves.toEqual({
      node_id: 's',
      name: 'CAÏN',
      description: 'x',
      has_homonyms: false,
    });
  });

  it('maps DSA_INVALID_SETTINGS to French', async () => {
    const { service } = failing('DSA_INVALID_SETTINGS: unknown setting(s): x');
    await expect(service.createSession({ graphSlug: 'mini', mode: 'LOCAL' })).rejects.toMatchObject({
      code: 'INVALID_SETTINGS',
      message: fr.errors.INVALID_SETTINGS,
    });
  });

  it('sends the canonical answer label as given, never raw speech', async () => {
    const state = { status: 'PLAYING', mode: 'LOCAL', awaiting: 'QUESTION', path: [], players: [] };
    const { service, calls } = succeeding(state);
    await service.answer('s1', 'OUIOUIOUI');
    expect(calls[0]).toEqual({ fn: 'dsa_answer', args: { p_session_id: 's1', p_answer_label: 'OUIOUIOUI' } });
  });

  it('normalises a state that omits the optional fields', async () => {
    const { service } = succeeding({ status: 'PLAYING', mode: 'AI_TIREUR', awaiting: 'QUESTION' });
    await expect(service.getState('s1')).resolves.toEqual({
      status: 'PLAYING',
      mode: 'AI_TIREUR',
      awaiting: 'QUESTION',
      prompt: null,
      dead_end: false,
      pending_guess: null,
      path: [],
      players: [],
      settings: { input_mode: 'BUTTONS' },
    });
  });
});
