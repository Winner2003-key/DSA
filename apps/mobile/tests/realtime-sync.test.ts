/**
 * Keeping a room in sync (brief S6): Realtime events are debounced (~150 ms) into
 * one `dsa_get_state`, and polling (5 s) runs only while the channel isn't
 * SUBSCRIBED. The channel is a fake; time is Jest's.
 */
import { createGameSubscription, type ChannelEvents, type ChannelStatus } from '@/services/realtime-sync';
import { SupabaseGameService, supabaseGameChannel } from '@/services/supabase-game-service';

jest.mock('@/services/supabase', () => {
  const actual = jest.requireActual('@/services/supabase');
  return { ...actual, ensureRealtimeAuth: jest.fn() };
});

/** A channel the test drives: events and statuses on demand. */
function fakeChannels() {
  const opened: { events: ChannelEvents; closed: boolean }[] = [];
  const open = (events: ChannelEvents) => {
    const entry = { events, closed: false };
    opened.push(entry);
    return {
      close: () => {
        entry.closed = true;
      },
    };
  };
  const current = () => opened[opened.length - 1]!;
  return {
    open,
    opened,
    event: () => current().events.onEvent(),
    status: (status: ChannelStatus) => current().events.onStatus(status),
  };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('createGameSubscription', () => {
  it('debounces a burst of events into one refetch', () => {
    const channels = fakeChannels();
    const onChange = jest.fn();
    createGameSubscription({ open: channels.open, onChange });
    channels.status('SUBSCRIBED');
    jest.advanceTimersByTime(150);
    onChange.mockClear(); // the catch-up read after subscribing

    // A move is an INSERT on game_moves plus an UPDATE on game_sessions.
    channels.event();
    jest.advanceTimersByTime(40);
    channels.event();
    jest.advanceTimersByTime(40);
    channels.event();
    expect(onChange).not.toHaveBeenCalled();
    jest.advanceTimersByTime(149);
    expect(onChange).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);

    // Events far apart are separate refetches.
    channels.event();
    jest.advanceTimersByTime(150);
    channels.event();
    jest.advanceTimersByTime(150);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('reads the state once when the channel becomes subscribed (events before it were missed)', () => {
    const channels = fakeChannels();
    const onChange = jest.fn();
    const onStatus = jest.fn();
    const sub = createGameSubscription({ open: channels.open, onChange, onStatus });
    expect(sub.status()).toBe('CONNECTING');
    channels.status('SUBSCRIBED');
    expect(onStatus).toHaveBeenLastCalledWith('SUBSCRIBED');
    jest.advanceTimersByTime(150);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('polls every 5 s only while the channel is not subscribed', () => {
    const channels = fakeChannels();
    const onChange = jest.fn();
    const onStatus = jest.fn();
    createGameSubscription({ open: channels.open, onChange, onStatus });

    // Connecting: the fallback is already on.
    jest.advanceTimersByTime(4999);
    expect(onChange).toHaveBeenCalledTimes(0);
    jest.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);

    // Subscribed: no more polling, only the catch-up read.
    channels.status('SUBSCRIBED');
    jest.advanceTimersByTime(30_000);
    expect(onChange).toHaveBeenCalledTimes(2);

    // The channel drops: polling again, and the status says so.
    channels.status('CHANNEL_ERROR');
    expect(onStatus).toHaveBeenLastCalledWith('RECONNECTING');
    jest.advanceTimersByTime(15_000);
    expect(onChange).toHaveBeenCalledTimes(5);

    channels.status('TIMED_OUT');
    jest.advanceTimersByTime(5000);
    expect(onChange).toHaveBeenCalledTimes(6);

    // Back: polling stops, one catch-up read.
    channels.status('SUBSCRIBED');
    jest.advanceTimersByTime(60_000);
    expect(onChange).toHaveBeenCalledTimes(7);
  });

  it('resubscribe opens a new channel and ignores the old one', () => {
    const channels = fakeChannels();
    const onChange = jest.fn();
    const onStatus = jest.fn();
    const sub = createGameSubscription({ open: channels.open, onChange, onStatus });
    channels.status('SUBSCRIBED');
    jest.advanceTimersByTime(150);
    const old = channels.opened[0]!;

    sub.resubscribe();
    expect(old.closed).toBe(true);
    expect(channels.opened).toHaveLength(2);
    expect(sub.status()).toBe('CONNECTING');

    onChange.mockClear();
    old.events.onEvent();
    old.events.onStatus('SUBSCRIBED');
    jest.advanceTimersByTime(150);
    expect(onChange).not.toHaveBeenCalled();
    expect(sub.status()).toBe('CONNECTING');

    channels.status('SUBSCRIBED');
    jest.advanceTimersByTime(150);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('close stops everything: channel, debounce and polling', () => {
    const channels = fakeChannels();
    const onChange = jest.fn();
    const sub = createGameSubscription({ open: channels.open, onChange });
    channels.event();
    sub.close();
    expect(channels.opened[0]!.closed).toBe(true);
    channels.event();
    channels.status('CLOSED');
    jest.advanceTimersByTime(60_000);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('SupabaseGameService.subscribe', () => {
  it('pushes are on, and subscribe uses the injected channel', () => {
    const channels = fakeChannels();
    const service = new SupabaseGameService({
      client: { rpc: async () => ({ data: null, error: null }) },
      ensureAuth: async () => undefined,
      openChannel: () => channels.open,
    });
    expect(service.supportsRealtime).toBe(true);

    const onChange = jest.fn();
    const onStatus = jest.fn();
    const unsubscribe = service.subscribe('s1', onChange, onStatus);
    channels.status('SUBSCRIBED');
    channels.event();
    jest.advanceTimersByTime(150);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith('SUBSCRIBED');

    unsubscribe();
    expect(channels.opened[0]!.closed).toBe(true);
  });

  it('listens to postgres_changes on the session, its moves and its players, filtered to that session', async () => {
    const bindings: { type: string; filter: Record<string, string> }[] = [];
    let statusCallback: ((status: string) => void) | null = null;
    const removed: unknown[] = [];
    const channel = {
      on(type: string, filter: Record<string, string>) {
        bindings.push({ type, filter });
        return channel;
      },
      subscribe(callback: (status: string) => void) {
        statusCallback = callback;
        return channel;
      },
    };
    const topics: string[] = [];
    const client = {
      channel: (topic: string) => {
        topics.push(topic);
        return channel;
      },
      removeChannel: (c: unknown) => {
        removed.push(c);
        return Promise.resolve('ok');
      },
    };
    const { ensureRealtimeAuth } = jest.requireMock('@/services/supabase') as { ensureRealtimeAuth: jest.Mock };
    ensureRealtimeAuth.mockResolvedValue(client);

    const statuses: string[] = [];
    const handle = supabaseGameChannel('abc')({ onEvent: () => undefined, onStatus: (s) => statuses.push(s) });
    await Promise.resolve();
    await Promise.resolve();

    expect(topics[0]).toMatch(/^game:abc:\d+$/);
    expect(bindings).toEqual([
      { type: 'postgres_changes', filter: { event: '*', schema: 'public', table: 'game_sessions', filter: 'id=eq.abc' } },
      { type: 'postgres_changes', filter: { event: '*', schema: 'public', table: 'game_moves', filter: 'game_session_id=eq.abc' } },
      { type: 'postgres_changes', filter: { event: '*', schema: 'public', table: 'game_players', filter: 'game_session_id=eq.abc' } },
    ]);
    statusCallback!('SUBSCRIBED');
    expect(statuses).toEqual(['SUBSCRIBED']);
    handle.close();
    expect(removed).toEqual([channel]);
  });

  it('reports a failed sign-in as a channel error, so polling takes over', async () => {
    const { ensureRealtimeAuth } = jest.requireMock('@/services/supabase') as { ensureRealtimeAuth: jest.Mock };
    ensureRealtimeAuth.mockRejectedValue(new Error('offline'));
    const statuses: string[] = [];
    supabaseGameChannel('abc')({ onEvent: () => undefined, onStatus: (s) => statuses.push(s) });
    await Promise.resolve();
    await Promise.resolve();
    expect(statuses).toEqual(['CHANNEL_ERROR']);
  });
});
