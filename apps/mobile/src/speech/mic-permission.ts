/**
 * The microphone permission on a phone — and the file TypeScript reads for every
 * platform (Metro gives the web `mic-permission.web.ts`).
 *
 * The trap is the same as in a browser: iOS asks once and never again, Android
 * stops asking after "Ne plus demander", and `requestRecordingPermissionsAsync`
 * then resolves refused without showing anything. So asking again is always
 * tried, and when the system says it will not ask (`canAskAgain: false`) the
 * player is pointed at the app's own settings page, which `openSettings` opens.
 *
 * expo-audio is loaded lazily: it is missing on the platforms that fall back to
 * this file, and mocked in the tests.
 */
import { Linking, Platform } from 'react-native';

import type { MicHelpKind, MicPermissionPort, MicPermissionState } from './mic-permission-types';

export * from './mic-permission-types';

interface AudioPermissions {
  getRecordingPermissionsAsync?: () => Promise<{ granted: boolean; canAskAgain?: boolean }>;
  requestRecordingPermissionsAsync?: () => Promise<{ granted: boolean; canAskAgain?: boolean }>;
}

function audio(): AudioPermissions | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-audio') as AudioPermissions;
  } catch {
    return null;
  }
}

function stateOf(result: { granted: boolean; canAskAgain?: boolean } | undefined): MicPermissionState {
  if (!result || typeof result.granted !== 'boolean') return 'unknown';
  if (result.granted) return 'granted';
  return result.canAskAgain === false ? 'denied' : 'prompt';
}

async function read(): Promise<MicPermissionState> {
  const module = audio();
  if (typeof module?.getRecordingPermissionsAsync !== 'function') return 'unknown';
  try {
    return stateOf(await module.getRecordingPermissionsAsync());
  } catch {
    return 'unknown';
  }
}

async function request(): Promise<MicPermissionState> {
  const module = audio();
  if (typeof module?.requestRecordingPermissionsAsync !== 'function') return 'unknown';
  const current = await read();
  if (current === 'granted') return 'granted';
  try {
    // Asked even when the system says it will not ask: it costs nothing, and a
    // player who has just turned the switch on in the settings gets straight in.
    return stateOf(await module.requestRecordingPermissionsAsync());
  } catch {
    return 'unknown';
  }
}

/**
 * A phone has nothing to subscribe to: the switch is turned in the system
 * settings, which sends the app to the background. Coming back re-reads it.
 */
function watch(listener: (state: MicPermissionState) => void): () => void {
  let stopped = false;
  const recheck = (state: string) => {
    if (state !== 'active') return;
    void read().then((next) => {
      if (!stopped) listener(next);
    });
  };
  // Imported here so this file stays usable where AppState is absent.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const appState = (require('react-native') as typeof import('react-native')).AppState;
  const subscription = appState?.addEventListener?.('change', recheck);
  return () => {
    stopped = true;
    subscription?.remove?.();
  };
}

function helpKind(): MicHelpKind {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? 'phone' : 'generic';
}

export const micPermission: MicPermissionPort = {
  get available() {
    return Platform.OS === 'ios' || Platform.OS === 'android';
  },
  read,
  request,
  watch,
  helpKind,
  openSettings: () => {
    void Linking.openSettings?.().catch(() => undefined);
  },
};
