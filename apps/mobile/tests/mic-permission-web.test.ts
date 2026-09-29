/**
 * The browser side of the microphone permission: telling a refusal the browser
 * will ask about again from one it has stored, since that is what decides whether
 * the app asks again by itself or shows the player where the switch is.
 */
import { micPermission } from '@/speech/mic-permission.web';

type Query = () => Promise<{ state: string; addEventListener?: unknown; removeEventListener?: unknown }>;

function setNavigator(parts: { getUserMedia?: unknown; query?: Query | null; userAgent?: string }): void {
  const global = globalThis as unknown as { navigator?: Record<string, unknown> };
  const target: Record<string, unknown> = global.navigator ?? {};
  if (!global.navigator) {
    Object.defineProperty(globalThis, 'navigator', { value: target, configurable: true, writable: true });
  }
  const define = (key: string, value: unknown) => Object.defineProperty(target, key, { value, configurable: true, writable: true });
  define('mediaDevices', parts.getUserMedia ? { getUserMedia: parts.getUserMedia } : undefined);
  define('permissions', parts.query ? { query: parts.query } : undefined);
  if (parts.userAgent !== undefined) define('userAgent', parts.userAgent);
}

const track = () => ({ stop: jest.fn() });
const streamOf = (stopped: { stop: jest.Mock }[]) => ({ getTracks: () => stopped });
const refusal = () => Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });

describe('asking the browser again', () => {
  it('asked and allowed: granted, and the microphone is let go straight away', async () => {
    const tracks = [track()];
    setNavigator({ getUserMedia: jest.fn().mockResolvedValue(streamOf(tracks)), query: async () => ({ state: 'prompt' }) });
    await expect(micPermission.request()).resolves.toBe('granted');
    // The recorder opens the microphone itself: this was only a question.
    expect(tracks[0]?.stop).toHaveBeenCalled();
  });

  it('already allowed: nothing is asked, and the microphone is not opened to find out', async () => {
    const getUserMedia = jest.fn();
    setNavigator({ getUserMedia, query: async () => ({ state: 'granted' }) });
    await expect(micPermission.request()).resolves.toBe('granted');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('a refusal the browser did not store reads as "prompt": the next try asks again', async () => {
    setNavigator({ getUserMedia: jest.fn().mockRejectedValue(refusal()), query: async () => ({ state: 'prompt' }) });
    await expect(micPermission.request()).resolves.toBe('prompt');
  });

  it('a refusal the browser stored reads as "denied": no dialog will come', async () => {
    setNavigator({ getUserMedia: jest.fn().mockRejectedValue(refusal()), query: async () => ({ state: 'denied' }) });
    await expect(micPermission.request()).resolves.toBe('denied');
  });

  it('a browser that will not say (Safari) is treated as stored, so the steps are shown', async () => {
    setNavigator({
      getUserMedia: jest.fn().mockRejectedValue(refusal()),
      query: () => Promise.reject(new TypeError('microphone is not a valid permission name')),
    });
    await expect(micPermission.read()).resolves.toBe('unknown');
    await expect(micPermission.request()).resolves.toBe('denied');
  });

  it('no microphone at all is not a refusal', async () => {
    setNavigator({
      getUserMedia: jest.fn().mockRejectedValue(Object.assign(new Error('no device'), { name: 'NotFoundError' })),
      query: async () => ({ state: 'prompt' }),
    });
    await expect(micPermission.request()).resolves.toBe('unknown');
  });
});

it('notices the switch being turned in the browser’s own panel', async () => {
  const handlers: (() => void)[] = [];
  const status = {
    state: 'denied',
    addEventListener: (_event: string, handler: () => void) => handlers.push(handler),
    removeEventListener: jest.fn(),
  };
  setNavigator({ getUserMedia: jest.fn(), query: async () => status });
  const seen: string[] = [];
  const unwatch = micPermission.watch((state) => seen.push(state));
  await new Promise((resolve) => setTimeout(resolve, 0));

  status.state = 'granted';
  handlers.forEach((handler) => handler());
  expect(seen).toContain('granted');
  unwatch();
  expect(status.removeEventListener).toHaveBeenCalled();
});

it('names the browser whose instructions fit', () => {
  const kindFor = (userAgent: string) => {
    setNavigator({ getUserMedia: jest.fn(), query: null, userAgent });
    return micPermission.helpKind();
  };
  expect(kindFor('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36')).toBe('chromium');
  expect(kindFor('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe('firefox');
  expect(kindFor('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15')).toBe('safari');
  expect(kindFor('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36')).toBe('androidBrowser');
  // Every browser on an iPhone is Safari underneath: the switch is in Réglages.
  expect(kindFor('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 CriOS/140 Mobile/15E148 Safari/604.1')).toBe('iosBrowser');
});
