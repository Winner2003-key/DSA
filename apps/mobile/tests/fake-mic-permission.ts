/**
 * A scripted microphone permission, standing in for the browser's own. Install it with
 *   jest.mock('@/speech/mic-permission', () => require('./fake-mic-permission'));
 * then set `fakeMicPermission.state` to what the platform stores, and
 * `fakeMicPermission.onRequest` to what asking again will get.
 */
import type { MicHelpKind, MicPermissionPort, MicPermissionState } from '@/speech/mic-permission-types';

export * from '@/speech/mic-permission-types';

const listeners = new Set<(state: MicPermissionState) => void>();

export const fakeMicPermission: {
  /** What the platform says now. */
  state: MicPermissionState;
  /** What `request()` resolves to; null keeps `state` as it is (a refusal). */
  onRequest: MicPermissionState | null;
  /** Which browser's instructions to show. */
  helpKind: MicHelpKind;
  asks: number;
} = { state: 'prompt', onRequest: null, helpKind: 'chromium', asks: 0 };

export function resetFakeMicPermission(): void {
  fakeMicPermission.state = 'prompt';
  fakeMicPermission.onRequest = null;
  fakeMicPermission.helpKind = 'chromium';
  fakeMicPermission.asks = 0;
  listeners.clear();
}

/** The player turns the microphone back on in the browser's own panel. */
export function allowFromBrowser(): void {
  fakeMicPermission.state = 'granted';
  for (const listener of listeners) listener('granted');
}

export const micPermission: MicPermissionPort = {
  available: true,
  read: async () => fakeMicPermission.state,
  request: async () => {
    fakeMicPermission.asks += 1;
    fakeMicPermission.state = fakeMicPermission.onRequest ?? fakeMicPermission.state;
    return fakeMicPermission.state;
  },
  watch: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  helpKind: () => fakeMicPermission.helpKind,
};
