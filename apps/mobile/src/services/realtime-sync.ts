/**
 * Keeping one game in sync across devices (brief S6): Realtime pushes, a short
 * debounce so a burst of row changes (a move plus the session update) costs one
 * `dsa_get_state`, and polling only while the channel is not subscribed.
 *
 * Nothing here knows about Supabase: `open` creates the actual channel, so the
 * timing logic is unit-tested with a fake channel and fake timers.
 */

/** What the UI needs to know about the push channel. */
export type RealtimeStatus = 'CONNECTING' | 'SUBSCRIBED' | 'RECONNECTING';

/** The statuses `RealtimeChannel.subscribe` reports. */
export type ChannelStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';

export interface ChannelEvents {
  /** A row of the session changed. The payload is ignored on purpose. */
  onEvent: () => void;
  onStatus: (status: ChannelStatus) => void;
}

/** Opens a channel and returns how to close it. Called again on `resubscribe`. */
export type OpenChannel = (events: ChannelEvents) => { close: () => void };

export const REALTIME_DEBOUNCE_MS = 150;
export const FALLBACK_POLL_MS = 5000;

export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

const globalTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface GameSubscriptionOptions {
  open: OpenChannel;
  onChange: () => void;
  onStatus?: (status: RealtimeStatus) => void;
  debounceMs?: number;
  pollMs?: number;
  timers?: Timers;
}

export interface GameSubscription {
  readonly status: () => RealtimeStatus;
  /** Drops the channel and opens a new one (the app came back to the foreground). */
  resubscribe: () => void;
  close: () => void;
}

export function createGameSubscription(options: GameSubscriptionOptions): GameSubscription {
  const debounceMs = options.debounceMs ?? REALTIME_DEBOUNCE_MS;
  const pollMs = options.pollMs ?? FALLBACK_POLL_MS;
  const timers = options.timers ?? globalTimers;

  let status: RealtimeStatus = 'CONNECTING';
  let closed = false;
  let generation = 0;
  let channel: { close: () => void } | null = null;
  let debounce: unknown = null;
  let poll: unknown = null;

  const setStatus = (next: RealtimeStatus) => {
    if (next === status) return;
    status = next;
    options.onStatus?.(next);
  };

  const changed = () => {
    if (closed) return;
    if (debounce !== null) timers.clearTimeout(debounce);
    debounce = timers.setTimeout(() => {
      debounce = null;
      if (!closed) options.onChange();
    }, debounceMs);
  };

  const startPolling = () => {
    if (poll !== null || closed) return;
    poll = timers.setInterval(() => {
      if (!closed) options.onChange();
    }, pollMs);
  };

  const stopPolling = () => {
    if (poll === null) return;
    timers.clearInterval(poll);
    poll = null;
  };

  const open = () => {
    const mine = ++generation;
    setStatus('CONNECTING');
    startPolling();
    channel = options.open({
      onEvent: () => {
        if (mine === generation) changed();
      },
      onStatus: (channelStatus) => {
        if (mine !== generation || closed) return;
        if (channelStatus === 'SUBSCRIBED') {
          stopPolling();
          setStatus('SUBSCRIBED');
          // Whatever happened before the channel was listening (or while it was
          // down) produced no event: read the state once.
          changed();
        } else {
          setStatus('RECONNECTING');
          startPolling();
        }
      },
    });
  };

  const closeChannel = () => {
    const current = channel;
    channel = null;
    generation += 1;
    current?.close();
  };

  open();

  return {
    status: () => status,
    resubscribe: () => {
      if (closed) return;
      closeChannel();
      open();
    },
    close: () => {
      if (closed) return;
      closed = true;
      closeChannel();
      stopPolling();
      if (debounce !== null) timers.clearTimeout(debounce);
      debounce = null;
    },
  };
}
